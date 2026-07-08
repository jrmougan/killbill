-- Phase 2b: relational Category table alongside the ExpenseCategory enum.
-- Additive + reversible: the enum column stays the source of truth; categoryId
-- is nullable and dual-written. utf8mb4/unicode_ci charset is required so the
-- FKs to Couple/Category match (see Phase 1 collation lesson).

CREATE TABLE `Category` (
  `id`        VARCHAR(191) NOT NULL,
  `key`       VARCHAR(191) NOT NULL,
  `label`     VARCHAR(191) NOT NULL,
  `labelEn`   VARCHAR(191) NOT NULL,
  `emoji`     VARCHAR(191) NOT NULL,
  `icon`      VARCHAR(191) NOT NULL,
  `color`     VARCHAR(191) NOT NULL,
  `bgColor`   VARCHAR(191) NOT NULL,
  `hex`       VARCHAR(191) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `isSystem`  BOOLEAN NOT NULL DEFAULT false,
  `groupId`   VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Category_groupId_key_key` (`groupId`, `key`),
  INDEX `Category_groupId_idx` (`groupId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Category`
  ADD CONSTRAINT `Category_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Expense.categoryId (nullable FK, dual-written with the enum)
ALTER TABLE `Expense` ADD COLUMN `categoryId` VARCHAR(191) NULL;
CREATE INDEX `Expense_categoryId_idx` ON `Expense`(`categoryId`);
ALTER TABLE `Expense`
  ADD CONSTRAINT `Expense_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Budget.categoryId (nullable FK, dual-written with the enum)
ALTER TABLE `Budget` ADD COLUMN `categoryId` VARCHAR(191) NULL;
CREATE INDEX `Budget_categoryId_idx` ON `Budget`(`categoryId`);
ALTER TABLE `Budget`
  ADD CONSTRAINT `Budget_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
