-- Capture schema changes that were applied to the database (and reflected in
-- schema.prisma) but never recorded as a migration, so `migrate deploy` on a
-- fresh database reproduces the real schema:
--   1. Expense.status (created by 20260125125249_check_sync) was dropped.
--   2. Tag gained a unique constraint on (name, coupleId).

-- DropColumn
ALTER TABLE `Expense` DROP COLUMN `status`;

-- CreateIndex
CREATE UNIQUE INDEX `Tag_name_coupleId_key` ON `Tag`(`name`, `coupleId`);
