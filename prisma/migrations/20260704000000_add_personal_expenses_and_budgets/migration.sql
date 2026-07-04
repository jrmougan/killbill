-- Personal vs shared expenses + personal budgets.
-- Existing rows are all couple ("shared") expenses, so they are backfilled
-- with visibility=SHARED and ownerId=paidById.

-- Expense: visibility (default SHARED preserves current behaviour for new + existing rows)
ALTER TABLE `Expense` ADD COLUMN `visibility` ENUM('PERSONAL', 'SHARED') NOT NULL DEFAULT 'SHARED';

-- Expense: ownerId — add nullable, backfill from the payer, then enforce NOT NULL
ALTER TABLE `Expense` ADD COLUMN `ownerId` VARCHAR(191) NULL;
UPDATE `Expense` SET `ownerId` = `paidById` WHERE `ownerId` IS NULL;
ALTER TABLE `Expense` MODIFY `ownerId` VARCHAR(191) NOT NULL;

-- Expense: personal expenses have no couple, so coupleId becomes nullable
ALTER TABLE `Expense` MODIFY `coupleId` VARCHAR(191) NULL;

-- Expense: indexes + owner FK
CREATE INDEX `Expense_ownerId_idx` ON `Expense`(`ownerId`);
CREATE INDEX `Expense_ownerId_visibility_idx` ON `Expense`(`ownerId`, `visibility`);
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Budget: a budget is either shared (coupleId) or personal (ownerId)
ALTER TABLE `Budget` MODIFY `coupleId` VARCHAR(191) NULL;
ALTER TABLE `Budget` ADD COLUMN `ownerId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Budget_category_month_ownerId_key` ON `Budget`(`category`, `month`, `ownerId`);
CREATE INDEX `Budget_ownerId_idx` ON `Budget`(`ownerId`);
ALTER TABLE `Budget` ADD CONSTRAINT `Budget_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
