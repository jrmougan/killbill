-- Phase 2c: relational ReceiptLineItem, replacing the Expense.receiptData JSON.
-- Additive + reversible: receiptData stays the source of truth for splits/display;
-- ReceiptLineItem is backfilled and dual-written. Money is stored in integer
-- cents here (the legacy JSON used euro floats). utf8mb4/unicode_ci for FK parity.

CREATE TABLE `ReceiptLineItem` (
  `id`           VARCHAR(191) NOT NULL,
  `expenseId`    VARCHAR(191) NOT NULL,
  `description`  VARCHAR(191) NOT NULL,
  `quantity`     DOUBLE NOT NULL DEFAULT 1,
  `unitPrice`    INT NOT NULL,
  `lineTotal`    INT NOT NULL,
  `position`     INT NOT NULL DEFAULT 0,
  `assignedToId` VARCHAR(191) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ReceiptLineItem_expenseId_idx` (`expenseId`),
  INDEX `ReceiptLineItem_assignedToId_idx` (`assignedToId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ReceiptLineItem`
  ADD CONSTRAINT `ReceiptLineItem_expenseId_fkey`
    FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ReceiptLineItem_assignedToId_fkey`
    FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
