-- Phase 4 (recurring-sync): additive deactivation flag on RecurringSeries.
--
-- Why a flag and not DELETE: Expense.seriesId has ON DELETE SET NULL, so
-- deleting a series would null out the seriesId of every already-materialized
-- instance and lose the lineage between instances and their rule. Deactivation
-- (isActive = false) stops the series-driven materializer while preserving
-- that lineage, and is trivially reversible (toggle recurring back ON re-sets
-- isActive = true on the same row).
--
-- Additive + reversible. Existing rows default to active, which is correct:
-- every existing series was created from (or backfilled for) a live
-- isRecurring=true template.

ALTER TABLE `RecurringSeries`
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

-- The materializer's hot query is (coupleId|ownerId, visibility, isActive,
-- nextRunDate <= now); this composite lets it skip deactivated series without
-- scanning. The old single-column nextRunDate index is left in place
-- (dropping indexes is out of scope for an additive pass).
CREATE INDEX `RecurringSeries_isActive_nextRunDate_idx`
  ON `RecurringSeries`(`isActive`, `nextRunDate`);
