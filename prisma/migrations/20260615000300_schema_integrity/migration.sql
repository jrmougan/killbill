-- Schema integrity: align referential actions (ON DELETE) and fix Tag.color drift.

-- ---------------------------------------------------------------------------
-- 1. Couple-owned relations -> ON DELETE CASCADE
--    Deleting a Couple cleanly removes its dependent rows.
-- ---------------------------------------------------------------------------

-- Expense -> Couple
ALTER TABLE `Expense` DROP FOREIGN KEY `Expense_coupleId_fkey`;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Settlement -> Couple
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_coupleId_fkey`;
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Tag -> Couple
ALTER TABLE `Tag` DROP FOREIGN KEY `Tag_coupleId_fkey`;
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Budget -> Couple
ALTER TABLE `Budget` DROP FOREIGN KEY `Budget_coupleId_fkey`;
ALTER TABLE `Budget` ADD CONSTRAINT `Budget_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. User-owned relations -> ON DELETE CASCADE
--    In a 2-person couple app a user's expenses, splits and settlements are
--    meaningless once the user is gone, so cascade rather than leave dangling
--    FKs or block deletion. Chosen Cascade consistently across all four.
-- ---------------------------------------------------------------------------

-- Expense.paidBy -> User
ALTER TABLE `Expense` DROP FOREIGN KEY `Expense_paidById_fkey`;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_paidById_fkey` FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Split.user -> User
ALTER TABLE `Split` DROP FOREIGN KEY `Split_userId_fkey`;
ALTER TABLE `Split` ADD CONSTRAINT `Split_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Settlement.fromUser -> User
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_fromUserId_fkey`;
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Settlement.toUser -> User
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_toUserId_fkey`;
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Tag.color drift: original migration created it NULL with no default;
--    schema declares NOT NULL DEFAULT '#8b5cf6'. Backfill then make NOT NULL.
-- ---------------------------------------------------------------------------
UPDATE `Tag` SET `color` = '#8b5cf6' WHERE `color` IS NULL;
ALTER TABLE `Tag` MODIFY `color` VARCHAR(191) NOT NULL DEFAULT '#8b5cf6';
