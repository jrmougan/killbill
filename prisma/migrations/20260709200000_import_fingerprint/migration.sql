-- Bank CSV import (decouple F2): content fingerprint for idempotent re-imports.
-- Additive + reversible (DROP INDEX + DROP COLUMN).
ALTER TABLE `Expense` ADD COLUMN `importFingerprint` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Expense_importFingerprint_key` ON `Expense`(`importFingerprint`);
