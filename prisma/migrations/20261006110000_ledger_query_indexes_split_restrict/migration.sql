-- M3 — índices para los listados/paginación y limpieza de índices redundantes;
-- Split.userId Cascade → Restrict. Aditiva salvo los DROP de índices duplicados.
--
-- 1) Índices compuestos nuevos (se crean ANTES de borrar nada: pasan a ser el
--    índice que respalda las FK coupleId/ownerId por prefijo izquierdo):
--      Expense(coupleId, visibility, date)  → GET /api/expenses scope=shared
--      Expense(ownerId, visibility, date)   → GET /api/expenses scope=personal,
--                                             totales personales del mes
--      Settlement(coupleId, status)         → pendientes/confirmados por espacio
--
-- 2) Índices redundantes que se borran — SOLO los que quedan cubiertos por el
--    prefijo izquierdo de otro índice (MySQL exige un índice cuyo prefijo sea la
--    columna de cada FK; todos estos lo siguen teniendo):
--      Expense_coupleId_idx           ⊂ Expense_coupleId_visibility_date_idx
--      Expense_ownerId_idx            ⊂ Expense_ownerId_visibility_date_idx
--      Expense_ownerId_visibility_idx ⊂ Expense_ownerId_visibility_date_idx
--      Settlement_coupleId_idx        ⊂ Settlement_coupleId_status_idx
--      Membership_groupId_idx         ⊂ Membership_groupId_userId_key
--      Split_expenseId_idx            ⊂ Split_expenseId_userId_key
--      Account_groupId_idx            ⊂ Account_groupId_userId_key
--      LedgerEntry_transactionId_idx  ⊂ LedgerEntry_transactionId_accountId_key
--    Los DROP son condicionales (información de information_schema): prod ya ha
--    tenido drift de índices (scripts/prod-capture-schema-drift.sql), así que un
--    índice ausente no debe bloquear la cadena de migraciones.
--
-- 3) Split.userId: ON DELETE CASCADE → RESTRICT, como Expense.paidById/ownerId,
--    Settlement.from/to y Account.userId (20260711000000). Ningún flujo depende
--    de la cascada: /api/test/reset borra Split antes que User y la purga
--    (/api/cron/purge) solo borra User sombra sin ninguna referencia de dinero
--    (filtro `splits: { none: {} }` incluido). El ADD valida las filas: un
--    Split huérfano lo haría fallar. Pre-vuelo (debe dar 0):
--      SELECT COUNT(*) FROM `Split` s LEFT JOIN `User` u ON u.id = s.userId WHERE u.id IS NULL;
--
-- REVERSAL (a mano):
--   ALTER TABLE `Split` DROP FOREIGN KEY `Split_userId_fkey`;
--   ALTER TABLE `Split` ADD CONSTRAINT `Split_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--   CREATE INDEX `Expense_coupleId_idx` ON `Expense`(`coupleId`);  -- (ídem resto de índices)
--   DROP INDEX `Expense_coupleId_visibility_date_idx` ON `Expense`; -- (ídem resto)

-- 1) Nuevos índices compuestos
CREATE INDEX `Expense_coupleId_visibility_date_idx` ON `Expense`(`coupleId`, `visibility`, `date`);
CREATE INDEX `Expense_ownerId_visibility_date_idx` ON `Expense`(`ownerId`, `visibility`, `date`);
CREATE INDEX `Settlement_coupleId_status_idx` ON `Settlement`(`coupleId`, `status`);

-- 2) Borrado condicional de los índices redundantes
SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Expense_coupleId_idx` ON `Expense`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Expense' AND index_name = 'Expense_coupleId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Expense_ownerId_idx` ON `Expense`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Expense' AND index_name = 'Expense_ownerId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Expense_ownerId_visibility_idx` ON `Expense`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Expense' AND index_name = 'Expense_ownerId_visibility_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Settlement_coupleId_idx` ON `Settlement`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Settlement' AND index_name = 'Settlement_coupleId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Membership_groupId_idx` ON `Membership`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Membership' AND index_name = 'Membership_groupId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Split_expenseId_idx` ON `Split`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Split' AND index_name = 'Split_expenseId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `Account_groupId_idx` ON `Account`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'Account' AND index_name = 'Account_groupId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @drop_sql := (SELECT IF(COUNT(*) > 0, 'DROP INDEX `LedgerEntry_transactionId_idx` ON `LedgerEntry`', 'DO 0')
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'LedgerEntry' AND index_name = 'LedgerEntry_transactionId_idx');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Split.userId: Cascade → Restrict
ALTER TABLE `Split` DROP FOREIGN KEY `Split_userId_fkey`;
ALTER TABLE `Split` ADD CONSTRAINT `Split_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
