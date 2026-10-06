-- M1 — invariantes de ámbito a nivel de BD (MySQL >= 8.0.16; prod = MySQL 8.0).
--
-- Hasta ahora el XOR grupo/personal de Category/Tag/Budget/ShoppingList, la
-- coherencia visibility↔coupleId de Expense y Split.amount >= 0 eran solo
-- "por convención" del código. Esta migración los convierte en garantía.
--
-- POR QUÉ UNA COLUMNA GENERADA: MySQL PROHÍBE un CHECK sobre columnas usadas en
-- una acción referencial de FK (ERROR 3823) y groupId/ownerId/coupleId tienen
-- ON DELETE CASCADE / ON UPDATE CASCADE. Por eso cada tabla gana una columna
-- VIRTUAL generada `scopeKey` que vale la clave de su ámbito (o NULL si la fila
-- rompe la regla) y el CHECK se hace sobre ella (`scopeKey IS NOT NULL`). Es
-- VIRTUAL (no STORED: MySQL tampoco permite STORED sobre columnas con FK
-- CASCADE); añadirla es solo metadatos. En schema.prisma se modela como
-- `Unsupported("varchar(191)")?`: queda fuera del cliente (nunca se escribe) y
-- `prisma migrate diff` no ve drift.
--
-- Además, `scopeKey` cierra los UNIQUE que MySQL no aplica sobre NULL:
--   * Category: UNIQUE(scopeKey, key) → una sola fila de sistema por key
--     (@@unique([groupId,key]) no la protege con groupId = ownerId = NULL).
--   * Tag: UNIQUE(scopeKey, name) → nombres de etiquetas PERSONALES únicos por
--     dueño (el código ya lo comprobaba con findFirst, con carrera).
--   * Budget no lo necesita: con el XOR garantizado, cada fila cae siempre bajo
--     uno de sus dos UNIQUE con la columna de ámbito NO nula.
--
-- Rutas de escritura revisadas (2026-10-06): prisma/seed.ts y
-- scripts/seed-categories-and-backfill.ts (sistema: isSystem=1, ambos NULL);
-- category-crud.ts (isSystem forzado a 0 + exactamente uno de groupId/ownerId);
-- /api/tags (coupleId XOR ownerId); /api/budget (coupleId XOR ownerId);
-- list-crud.ts (groupId XOR ownerId); /api/expenses, /api/expenses/import,
-- /api/expenses/[id]/share, recurring.ts (SHARED ⇔ coupleId); /api/test/seed.
-- Split.amount: los importes CUSTOM se validan >= 0 y splits.ts ya no produce
-- negativos (un reparto negativo por una promoción asignada se recorta a 0 y se
-- reescala, ver reconcileItemizedSplits / rescaleSplits).
--
-- PRE-VUELO OBLIGATORIO (solo lectura; TODAS deben devolver 0 filas/0). MySQL
-- valida las filas existentes al añadir cada CHECK/UNIQUE, y un fallo deja la
-- migración a medias (DDL no transaccional) y bloquea el despliegue:
--   SELECT id FROM `Category` WHERE NOT (
--     (`isSystem` = 1 AND `groupId` IS NULL AND `ownerId` IS NULL) OR
--     (`isSystem` = 0 AND (`groupId` IS NULL) <> (`ownerId` IS NULL)));
--   SELECT `key`, COUNT(*) FROM `Category` WHERE `groupId` IS NULL AND `ownerId` IS NULL
--     GROUP BY `key` HAVING COUNT(*) > 1;
--   SELECT id FROM `Tag` WHERE (`coupleId` IS NULL) = (`ownerId` IS NULL);
--   SELECT `ownerId`, `name`, COUNT(*) FROM `Tag` WHERE `ownerId` IS NOT NULL
--     GROUP BY `ownerId`, `name` HAVING COUNT(*) > 1;
--   SELECT id FROM `Budget` WHERE (`coupleId` IS NULL) = (`ownerId` IS NULL);
--   SELECT id FROM `ShoppingList` WHERE (`groupId` IS NULL) = (`ownerId` IS NULL);
--   SELECT id FROM `Expense` WHERE NOT (
--     (`visibility` = 'SHARED' AND `coupleId` IS NOT NULL) OR
--     (`visibility` = 'PERSONAL' AND `coupleId` IS NULL));
--   SELECT COUNT(*) FROM `Split` WHERE `amount` < 0;
-- (Nota: Tag UNIQUE compara `name` con la collation de la columna,
-- utf8mb4_unicode_ci: "Viaje" y "viaje" cuentan como duplicado, igual que el
-- UNIQUE(name, coupleId) existente.)
--
-- REVERSAL (a mano, en este orden):
--   ALTER TABLE `Split`        DROP CHECK `chk_split_amount_nonneg`;
--   ALTER TABLE `Expense`      DROP CHECK `chk_expense_scope`;      ALTER TABLE `Expense`      DROP COLUMN `scopeKey`;
--   ALTER TABLE `ShoppingList` DROP CHECK `chk_shoppinglist_scope`; ALTER TABLE `ShoppingList` DROP COLUMN `scopeKey`;
--   ALTER TABLE `Budget`       DROP CHECK `chk_budget_scope`;       ALTER TABLE `Budget`       DROP COLUMN `scopeKey`;
--   DROP INDEX `Tag_scopeKey_name_key` ON `Tag`;          ALTER TABLE `Tag` DROP CHECK `chk_tag_scope`;           ALTER TABLE `Tag` DROP COLUMN `scopeKey`;
--   DROP INDEX `Category_scopeKey_key_key` ON `Category`; ALTER TABLE `Category` DROP CHECK `chk_category_scope`; ALTER TABLE `Category` DROP COLUMN `scopeKey`;

-- Category: sistema (isSystem, ambos NULL) | personalizada de espacio | personal.
ALTER TABLE `Category` ADD COLUMN `scopeKey` VARCHAR(191) GENERATED ALWAYS AS (
  CASE
    WHEN `isSystem` = 1 AND `groupId` IS NULL AND `ownerId` IS NULL THEN '_sys'
    WHEN `isSystem` = 0 AND `groupId` IS NOT NULL AND `ownerId` IS NULL THEN `groupId`
    WHEN `isSystem` = 0 AND `groupId` IS NULL AND `ownerId` IS NOT NULL THEN `ownerId`
  END) VIRTUAL;
ALTER TABLE `Category` ADD CONSTRAINT `chk_category_scope` CHECK (`scopeKey` IS NOT NULL);
CREATE UNIQUE INDEX `Category_scopeKey_key_key` ON `Category`(`scopeKey`, `key`);

-- Tag: de espacio (coupleId) XOR personal (ownerId).
ALTER TABLE `Tag` ADD COLUMN `scopeKey` VARCHAR(191) GENERATED ALWAYS AS (
  CASE
    WHEN `coupleId` IS NOT NULL AND `ownerId` IS NULL THEN `coupleId`
    WHEN `coupleId` IS NULL AND `ownerId` IS NOT NULL THEN `ownerId`
  END) VIRTUAL;
ALTER TABLE `Tag` ADD CONSTRAINT `chk_tag_scope` CHECK (`scopeKey` IS NOT NULL);
CREATE UNIQUE INDEX `Tag_scopeKey_name_key` ON `Tag`(`scopeKey`, `name`);

-- Budget: compartido (coupleId) XOR personal (ownerId).
ALTER TABLE `Budget` ADD COLUMN `scopeKey` VARCHAR(191) GENERATED ALWAYS AS (
  CASE
    WHEN `coupleId` IS NOT NULL AND `ownerId` IS NULL THEN `coupleId`
    WHEN `coupleId` IS NULL AND `ownerId` IS NOT NULL THEN `ownerId`
  END) VIRTUAL;
ALTER TABLE `Budget` ADD CONSTRAINT `chk_budget_scope` CHECK (`scopeKey` IS NOT NULL);

-- ShoppingList: de grupo (groupId) XOR personal (ownerId).
ALTER TABLE `ShoppingList` ADD COLUMN `scopeKey` VARCHAR(191) GENERATED ALWAYS AS (
  CASE
    WHEN `groupId` IS NOT NULL AND `ownerId` IS NULL THEN `groupId`
    WHEN `groupId` IS NULL AND `ownerId` IS NOT NULL THEN `ownerId`
  END) VIRTUAL;
ALTER TABLE `ShoppingList` ADD CONSTRAINT `chk_shoppinglist_scope` CHECK (`scopeKey` IS NOT NULL);

-- Expense: SHARED ⇔ coupleId NOT NULL; PERSONAL ⇔ coupleId NULL.
ALTER TABLE `Expense` ADD COLUMN `scopeKey` VARCHAR(191) GENERATED ALWAYS AS (
  CASE
    WHEN `visibility` = 'SHARED' AND `coupleId` IS NOT NULL THEN `coupleId`
    WHEN `visibility` = 'PERSONAL' AND `coupleId` IS NULL THEN `ownerId`
  END) VIRTUAL;
ALTER TABLE `Expense` ADD CONSTRAINT `chk_expense_scope` CHECK (`scopeKey` IS NOT NULL);

-- Split.amount >= 0 (0 es legítimo: 1 céntimo EQUAL entre 2 da [1, 0]).
ALTER TABLE `Split` ADD CONSTRAINT `chk_split_amount_nonneg` CHECK (`amount` >= 0);
