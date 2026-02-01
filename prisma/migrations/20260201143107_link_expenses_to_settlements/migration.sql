-- AlterTable
ALTER TABLE `Expense` ADD COLUMN `settlementId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
