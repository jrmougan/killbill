-- Phase 2e: generalize Budget from a single calendar `month` to an explicit
-- half-open period range [periodStart, periodEnd).
-- Additive + reversible: `month` and its two unique constraints stay the source
-- of truth this phase. periodStart/periodEnd are nullable and dual-written;
-- periodType is NOT NULL DEFAULT 'MONTH' since every existing budget is a month.
-- No FK is added, so no charset change is required on this ALTER.

ALTER TABLE `Budget`
  ADD COLUMN `periodStart` DATETIME(3) NULL,
  ADD COLUMN `periodEnd`   DATETIME(3) NULL,
  ADD COLUMN `periodType`  ENUM('MONTH','WEEK','YEAR','CUSTOM') NOT NULL DEFAULT 'MONTH';
