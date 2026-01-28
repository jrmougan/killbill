/*
  Warnings:

  - You are about to drop the column `groupId` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `groupId` on the `Settlement` table. All the data in the column will be lost.
  - You are about to drop the column `activeGroupId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Group` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserGroup` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `coupleId` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `coupleId` to the `Settlement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `Expense` DROP FOREIGN KEY `Expense_groupId_fkey`;

-- DropForeignKey
ALTER TABLE `Settlement` DROP FOREIGN KEY `Settlement_groupId_fkey`;

-- DropForeignKey
ALTER TABLE `User` DROP FOREIGN KEY `User_activeGroupId_fkey`;

-- DropForeignKey
ALTER TABLE `UserGroup` DROP FOREIGN KEY `UserGroup_groupId_fkey`;

-- DropForeignKey
ALTER TABLE `UserGroup` DROP FOREIGN KEY `UserGroup_userId_fkey`;

-- DropIndex
DROP INDEX `Expense_groupId_idx` ON `Expense`;

-- DropIndex
DROP INDEX `Settlement_groupId_idx` ON `Settlement`;

-- DropIndex
DROP INDEX `User_activeGroupId_fkey` ON `User`;

-- AlterTable
ALTER TABLE `Expense` DROP COLUMN `groupId`,
    ADD COLUMN `coupleId` VARCHAR(191) NOT NULL,
    ADD COLUMN `receiptData` JSON NULL,
    ADD COLUMN `receiptUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Settlement` DROP COLUMN `groupId`,
    ADD COLUMN `coupleId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `activeGroupId`,
    ADD COLUMN `coupleId` VARCHAR(191) NULL,
    ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE `Group`;

-- DropTable
DROP TABLE `UserGroup`;

-- CreateTable
CREATE TABLE `Couple` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Couple_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InviteCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `usedById` VARCHAR(191) NULL,

    UNIQUE INDEX `InviteCode_code_key`(`code`),
    UNIQUE INDEX `InviteCode_usedById_key`(`usedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Expense_coupleId_idx` ON `Expense`(`coupleId`);

-- CreateIndex
CREATE INDEX `Settlement_coupleId_idx` ON `Settlement`(`coupleId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InviteCode` ADD CONSTRAINT `InviteCode_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InviteCode` ADD CONSTRAINT `InviteCode_usedById_fkey` FOREIGN KEY (`usedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_coupleId_fkey` FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
