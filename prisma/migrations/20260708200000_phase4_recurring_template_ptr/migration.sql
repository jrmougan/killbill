-- Phase 5 (stop-dual-write, WS2): durable template pointer on RecurringSeries.
--
-- Replaces the isRecurring discriminator the materializer used to identify a
-- series' template. Additive + reversible: templateId is nullable+unique with an
-- ON DELETE SET NULL FK, so no other column is touched and existing recurrence
-- data (Expense.isRecurring/recurringInterval/nextRecurringDate) stays intact as
-- the rollback path. No-op on live prod (0 recurring rows); correct for restored
-- data via the backfill UPDATE below.
--
-- REVERSAL (run manually to revert — drops ONLY the new pointer):
--   ALTER TABLE `RecurringSeries` DROP FOREIGN KEY `RecurringSeries_templateId_fkey`;
--   DROP INDEX `RecurringSeries_templateId_key` ON `RecurringSeries`;
--   ALTER TABLE `RecurringSeries` DROP COLUMN `templateId`;

ALTER TABLE `RecurringSeries` ADD COLUMN `templateId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `RecurringSeries_templateId_key` ON `RecurringSeries`(`templateId`);

ALTER TABLE `RecurringSeries`
  ADD CONSTRAINT `RecurringSeries_templateId_fkey`
  FOREIGN KEY (`templateId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link each series to its recurring template (isRecurring is still
-- written at apply time; one template per seriesId). Idempotent.
UPDATE `RecurringSeries` s
  JOIN `Expense` e ON e.`seriesId` = s.`id` AND e.`isRecurring` = 1
  SET s.`templateId` = e.`id`
  WHERE s.`templateId` IS NULL;
