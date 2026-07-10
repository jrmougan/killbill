-- Phase 5 CONTRACT — irreversible legacy-column drops, applied AFTER the full
-- stop-dual-write phase (WS1..WS5) removed every reader and writer of these
-- columns. Reconciled with the actual DB state: the Budget unique index swap
-- (category+month -> categoryId+periodStart) already landed in
-- 20260708260000_phase4_budget_unique_swap, so this migration only drops columns.
--
-- ROLLBACK: restore from the mysqldump taken immediately before applying. There
-- is no forward undo — the raw column values are gone (their information survives
-- relationally: ReceiptLineItem, RecurringSeries+templateId, Budget periodStart/
-- categoryId, Category via categoryId, Membership).

-- STEP 1 — Expense.receiptData (ReceiptLineItem is the source of truth).
ALTER TABLE `Expense` DROP COLUMN `receiptData`;

-- STEP 2 — Expense recurrence template fields (RecurringSeries + seriesId/templateId
-- carry the schedule + lineage). RecurringInterval enum stays (RecurringSeries.interval).
ALTER TABLE `Expense`
  DROP COLUMN `isRecurring`,
  DROP COLUMN `recurringInterval`,
  DROP COLUMN `nextRecurringDate`;

-- STEP 3 — Budget.month (period range is periodStart/periodEnd; uniques already
-- swapped to categoryId+periodStart).
ALTER TABLE `Budget` DROP COLUMN `month`;

-- STEP 4 — enum category columns (Category table via categoryId is the sole source;
-- the ExpenseCategory enum is removed from schema.prisma in the same change).
ALTER TABLE `Expense`         DROP COLUMN `category`;
ALTER TABLE `Budget`          DROP COLUMN `category`;
ALTER TABLE `RecurringSeries` DROP COLUMN `category`;

-- STEP 5 — User.coupleId (Membership is the sole membership source). FK first.
ALTER TABLE `User` DROP FOREIGN KEY `User_coupleId_fkey`;
ALTER TABLE `User` DROP COLUMN `coupleId`;
