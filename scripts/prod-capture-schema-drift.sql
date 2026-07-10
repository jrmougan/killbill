-- Prod-adjusted replacement for migration 20260615000500_capture_schema_drift.
--
-- The committed migration was written against the DEV schema drift and does:
--     ALTER TABLE `Expense` DROP COLUMN `status`;
--     CREATE UNIQUE INDEX `Tag_name_coupleId_key` ON `Tag`(`name`,`coupleId`);
-- But PROD's drift differs: Expense.status does NOT exist there, so the DROP
-- fails with `ERROR 1091 Can't DROP 'status'` and blocks the whole chain (this is
-- exactly why the June migrations never applied to prod). This drift-aware version
-- skips the absent DROP and creates the index only if missing. Idempotent.
-- Use it INSTEAD of the committed migration.sql when bringing prod up to date,
-- then `prisma migrate resolve --applied 20260615000500_capture_schema_drift`.

SET @has_status := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'Expense' AND column_name = 'status');
SET @sql1 := IF(@has_status > 0, 'ALTER TABLE `Expense` DROP COLUMN `status`', 'DO 0');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'Tag' AND index_name = 'Tag_name_coupleId_key');
SET @sql2 := IF(@has_idx = 0, 'CREATE UNIQUE INDEX `Tag_name_coupleId_key` ON `Tag`(`name`, `coupleId`)', 'DO 0');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;
