-- Fase 4 — endurecimiento de cascadas User→dinero (§2.2 / §3 del plan de espacios).
--
-- Cambia de `Cascade` a `Restrict` (desde `User`) las FKs que atan la contabilidad
-- a una persona, para que borrar un `User` con actividad falle a nivel de BD en vez
-- de destruir silenciosamente la contabilidad del grupo:
--     Expense.paidById · Expense.ownerId
--     Settlement.fromUserId · Settlement.toUserId
--     Account.userId   (red de seguridad del ledger: LedgerEntry cuelga de Account,
--                       no de User, así que restringir aquí impide borrar un User con
--                       actividad de ledger sin tocar LedgerEntry)
-- Convierte "nunca DELETE físico de un User con actividad; baja = REMOVED/anonimizar"
-- de disciplina a garantía de schema.
--
-- MySQL: cambiar la acción onDelete de una FK = DROP FOREIGN KEY + ADD FOREIGN KEY.
-- El `ADD ... FOREIGN KEY` VALIDA todas las filas existentes: si hubiera una
-- referencia huérfana (paidById/ownerId/from/to/userId apuntando a un User inexistente)
-- el ADD fallaría y abortaría la migración. Ejecutar ANTES el pre-vuelo READ-ONLY
-- `npx tsx --env-file=.env scripts/validate-user-money-refs.ts` (debe dar 0 huérfanas).
-- Aditiva y reversible conceptualmente (ver REVERSAL abajo); no toca datos.
--
-- REVERSAL (volver a Cascade, ejecutar a mano si hay que revertir):
--   ALTER TABLE `Expense`    DROP FOREIGN KEY `Expense_paidById_fkey`;
--   ALTER TABLE `Expense`    ADD  CONSTRAINT  `Expense_paidById_fkey`    FOREIGN KEY (`paidById`)   REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE `Expense`    DROP FOREIGN KEY `Expense_ownerId_fkey`;
--   ALTER TABLE `Expense`    ADD  CONSTRAINT  `Expense_ownerId_fkey`     FOREIGN KEY (`ownerId`)    REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_fromUserId_fkey`;
--   ALTER TABLE `Settlement` ADD  CONSTRAINT  `Settlement_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_toUserId_fkey`;
--   ALTER TABLE `Settlement` ADD  CONSTRAINT  `Settlement_toUserId_fkey`   FOREIGN KEY (`toUserId`)   REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE `Account`    DROP FOREIGN KEY `Account_userId_fkey`;
--   ALTER TABLE `Account`    ADD  CONSTRAINT  `Account_userId_fkey`      FOREIGN KEY (`userId`)     REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Expense.paidById: Cascade → Restrict
ALTER TABLE `Expense` DROP FOREIGN KEY `Expense_paidById_fkey`;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_paidById_fkey` FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Expense.ownerId: Cascade → Restrict
ALTER TABLE `Expense` DROP FOREIGN KEY `Expense_ownerId_fkey`;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Settlement.fromUserId: Cascade → Restrict
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_fromUserId_fkey`;
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Settlement.toUserId: Cascade → Restrict
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_toUserId_fkey`;
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Account.userId: Cascade → Restrict
ALTER TABLE `Account` DROP FOREIGN KEY `Account_userId_fkey`;
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
