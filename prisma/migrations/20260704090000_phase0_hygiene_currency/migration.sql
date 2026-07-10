-- Phase 0: hygiene + currency-ready. Purely additive, behavior-preserving.
-- Timestamp columns backfill existing rows via DEFAULT CURRENT_TIMESTAMP(3).
-- Currency columns default to EUR / minorUnit 2, preserving today's semantics.

-- Expense: timestamps + currency
ALTER TABLE `Expense` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    ADD COLUMN `minorUnit` INTEGER NOT NULL DEFAULT 2;

-- Split: timestamps (currency is inherited from the parent Expense)
ALTER TABLE `Split` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Settlement: timestamps + currency
ALTER TABLE `Settlement` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    ADD COLUMN `minorUnit` INTEGER NOT NULL DEFAULT 2;

-- Budget: timestamps + currency
ALTER TABLE `Budget` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    ADD COLUMN `minorUnit` INTEGER NOT NULL DEFAULT 2;

-- Tag: timestamps
ALTER TABLE `Tag` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
