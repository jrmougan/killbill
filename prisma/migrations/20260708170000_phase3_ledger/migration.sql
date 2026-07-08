-- Phase 3: double-entry ledger (shadow of finance.ts).
--
-- Additive + reversible. finance.ts.calculateBalances stays the SOLE source of
-- truth this phase; the read-switch and any drop/rename are DEFERRED. Every
-- economic event that moves a group balance becomes ONE balanced
-- LedgerTransaction whose LedgerEntry rows are per-member NET deltas summing to
-- zero. A member's running entry-sum reproduces calculateBalances[member]
-- exactly, in integer cents.
--
--   * A SHARED Expense       -> one EXPENSE     transaction (delta[m] = paid[m] - share[m]).
--   * A CONFIRMED Settlement -> one SETTLEMENT  transaction (fromUser +amount, toUser -amount).
--   * PERSONAL expenses and non-CONFIRMED settlements produce NO transaction:
--     exclusion is by non-existence, not by a runtime filter.
--
-- Idempotency: LedgerTransaction.dedupeKey is UNIQUE
--   'expense:<id>' | 'settlement:<id>:confirm' | 'settlement:<id>:reverse:<seq>'
-- so backfill + dual-write self-heal instead of double-posting. The source FKs
-- (expenseId/settlementId) are NON-unique (a settlement may later carry both a
-- ':confirm' and reversing txns) and CASCADE so deleting a source expense/
-- settlement removes its ledger rows, keeping finance-parity (finance stops
-- counting a deleted row too).
--
-- FK CHARSET LESSON (Phase 1): every new table with a FK MUST be
-- utf8mb4/utf8mb4_unicode_ci — Couple.id/User.id/Expense.id/Settlement.id are
-- utf8mb4_unicode_ci VARCHAR(191); omit and the FK fails with collation
-- error 3780.
--
-- Rollback = DROP the three tables (finance.ts is untouched).

CREATE TABLE `Account` (
  `id`        VARCHAR(191) NOT NULL,
  `groupId`   VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Account_groupId_userId_key` (`groupId`, `userId`),
  INDEX `Account_groupId_idx` (`groupId`),
  INDEX `Account_userId_idx` (`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LedgerTransaction` (
  `id`           VARCHAR(191) NOT NULL,
  `groupId`      VARCHAR(191) NOT NULL,
  `kind`         ENUM('EXPENSE','SETTLEMENT') NOT NULL,
  `dedupeKey`    VARCHAR(191) NOT NULL,
  `amount`       INT NOT NULL,
  `postedAt`     DATETIME(3) NOT NULL,
  `expenseId`    VARCHAR(191) NULL,
  `settlementId` VARCHAR(191) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `LedgerTransaction_dedupeKey_key` (`dedupeKey`),
  INDEX `LedgerTransaction_groupId_kind_idx` (`groupId`, `kind`),
  INDEX `LedgerTransaction_expenseId_idx` (`expenseId`),
  INDEX `LedgerTransaction_settlementId_idx` (`settlementId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LedgerEntry` (
  `id`            VARCHAR(191) NOT NULL,
  `transactionId` VARCHAR(191) NOT NULL,
  `accountId`     VARCHAR(191) NOT NULL,
  `amount`        INT NOT NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `LedgerEntry_transactionId_accountId_key` (`transactionId`, `accountId`),
  INDEX `LedgerEntry_transactionId_idx` (`transactionId`),
  INDEX `LedgerEntry_accountId_idx` (`accountId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Account`
  ADD CONSTRAINT `Account_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Account_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LedgerTransaction`
  ADD CONSTRAINT `LedgerTransaction_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `Couple`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LedgerTransaction_expenseId_fkey`
    FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LedgerTransaction_settlementId_fkey`
    FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `LedgerEntry`
  ADD CONSTRAINT `LedgerEntry_transactionId_fkey`
    FOREIGN KEY (`transactionId`) REFERENCES `LedgerTransaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `LedgerEntry_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
