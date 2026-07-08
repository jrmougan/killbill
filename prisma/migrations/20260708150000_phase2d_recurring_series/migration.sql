-- Phase 2d: RecurringSeries — separate the recurring RULE/TEMPLATE from the
-- generated instances. Today recurrence lives on Expense itself
-- (isRecurring/recurringInterval/nextRecurringDate); this conflates template
-- and instance.
--
-- Additive + reversible: Expense.isRecurring/recurringInterval/nextRecurringDate
-- stay the source of truth this phase. RecurringSeries is backfilled from
-- existing template expenses and dual-written on creation/materialization.
-- Expense.seriesId is a nullable FK pointing generated instances (and their
-- template) at their series. utf8mb4/unicode_ci charset is required so the FKs
-- to Couple/User/Category match (see Phase 1 collation lesson).

CREATE TABLE `RecurringSeries` (
  `id`            VARCHAR(191) NOT NULL,
  `description`   VARCHAR(191) NOT NULL,
  `amount`        INT NOT NULL,
  `category`      ENUM('shopping','food','rent','utilities','transport','entertainment','health','other') NOT NULL DEFAULT 'other',
  `categoryId`    VARCHAR(191) NULL,
  `visibility`    ENUM('PERSONAL','SHARED') NOT NULL DEFAULT 'SHARED',
  `splitStrategy` ENUM('EQUAL','CUSTOM','EXCLUSIVE','ITEMIZED') NULL,
  `notes`         VARCHAR(191) NULL,
  `interval`      ENUM('weekly','monthly','yearly') NOT NULL,
  `nextRunDate`   DATETIME(3) NOT NULL,
  `coupleId`      VARCHAR(191) NULL,
  `ownerId`       VARCHAR(191) NOT NULL,
  `paidById`      VARCHAR(191) NOT NULL,
  `currency`      VARCHAR(191) NOT NULL DEFAULT 'EUR',
  `minorUnit`     INT NOT NULL DEFAULT 2,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `RecurringSeries_coupleId_idx` (`coupleId`),
  INDEX `RecurringSeries_ownerId_idx` (`ownerId`),
  INDEX `RecurringSeries_paidById_idx` (`paidById`),
  INDEX `RecurringSeries_categoryId_idx` (`categoryId`),
  INDEX `RecurringSeries_nextRunDate_idx` (`nextRunDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RecurringSeries`
  ADD CONSTRAINT `RecurringSeries_coupleId_fkey`
    FOREIGN KEY (`coupleId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RecurringSeries_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RecurringSeries_paidById_fkey`
    FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RecurringSeries_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Expense.seriesId — nullable FK; generated instances (and their template) point
-- at their series. ON DELETE SET NULL so removing a series never deletes history.
ALTER TABLE `Expense` ADD COLUMN `seriesId` VARCHAR(191) NULL;
CREATE INDEX `Expense_seriesId_idx` ON `Expense`(`seriesId`);
ALTER TABLE `Expense`
  ADD CONSTRAINT `Expense_seriesId_fkey`
    FOREIGN KEY (`seriesId`) REFERENCES `RecurringSeries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
