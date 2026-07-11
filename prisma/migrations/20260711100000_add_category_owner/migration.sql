-- AlterTable
ALTER TABLE `Category` ADD COLUMN `ownerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Category_ownerId_idx` ON `Category`(`ownerId`);

-- CreateIndex
CREATE UNIQUE INDEX `Category_ownerId_key_key` ON `Category`(`ownerId`, `key`);

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

