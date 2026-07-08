-- Phase 2a: persist how an expense's splits were derived.
-- Additive: a single nullable ENUM column on Expense. No existing data changed
-- by the DDL. Backfill is done best-effort out-of-band (see
-- scripts/backfill-split-strategy.ts); ambiguous/legacy rows may stay NULL.

ALTER TABLE `Expense`
  ADD COLUMN `splitStrategy` ENUM('EQUAL','CUSTOM','EXCLUSIVE','ITEMIZED') NULL;
