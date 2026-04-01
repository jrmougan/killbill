-- AlterTable: add notes, recurring fields to Expense
ALTER TABLE `Expense`
    ADD COLUMN `notes` VARCHAR(191) NULL,
    ADD COLUMN `isRecurring` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `recurringInterval` VARCHAR(191) NULL,
    ADD COLUMN `nextRecurringDate` DATETIME(3) NULL;

-- CreateTable: Tag
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `coupleId` VARCHAR(191) NOT NULL,

    INDEX `Tag_coupleId_idx`(`coupleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: ExpenseTag
CREATE TABLE `ExpenseTag` (
    `expenseId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`expenseId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Budget
CREATE TABLE `Budget` (
    `id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `month` DATETIME(3) NOT NULL,
    `coupleId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Budget_category_month_coupleId_key`(`category`, `month`, `coupleId`),
    INDEX `Budget_coupleId_idx`(`coupleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: Tag -> Couple
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ExpenseTag -> Expense
ALTER TABLE `ExpenseTag` ADD CONSTRAINT `ExpenseTag_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ExpenseTag -> Tag
ALTER TABLE `ExpenseTag` ADD CONSTRAINT `ExpenseTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Budget -> Couple
ALTER TABLE `Budget` ADD CONSTRAINT `Budget_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
