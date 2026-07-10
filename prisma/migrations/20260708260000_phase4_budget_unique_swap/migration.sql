-- Phase 5 (stop-dual-write, WS3): swap Budget uniques from (category,month,scope)
-- to (categoryId,periodStart,scope) and relax the legacy month/category columns to
-- nullable, so the POST upsert can stop writing them. Additive/reversible — NO
-- DROP COLUMN. Live DB has 0 budgets, so every tightening touches 0 rows.
--
-- REVERSAL is documented in DESIGN_reverse.sql (NOT an executable migration): it
-- backfills month:=periodStart and category:=Category.key, re-tightens NOT NULL,
-- recreates the old uniques, and restores the FK to ON DELETE SET NULL.

-- categoryId becomes NOT NULL (a nullable key part would defeat the unique, since
-- MySQL treats NULLs as distinct); the FK must move SetNull -> Restrict.
ALTER TABLE `Budget` DROP FOREIGN KEY `Budget_categoryId_fkey`;
ALTER TABLE `Budget` MODIFY `categoryId` VARCHAR(191) NOT NULL;
ALTER TABLE `Budget`
  ADD CONSTRAINT `Budget_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- periodStart becomes NOT NULL (key part; POST always writes it).
ALTER TABLE `Budget` MODIFY `periodStart` DATETIME(3) NOT NULL;

-- New period/category uniques IN, legacy month/enum uniques OUT.
CREATE UNIQUE INDEX `Budget_categoryId_periodStart_coupleId_key` ON `Budget`(`categoryId`, `periodStart`, `coupleId`);
CREATE UNIQUE INDEX `Budget_categoryId_periodStart_ownerId_key` ON `Budget`(`categoryId`, `periodStart`, `ownerId`);
DROP INDEX `Budget_category_month_coupleId_key` ON `Budget`;
DROP INDEX `Budget_category_month_ownerId_key` ON `Budget`;

-- Relax the legacy columns so the POST write-stop can omit them.
ALTER TABLE `Budget` MODIFY `month` DATETIME(3) NULL;
ALTER TABLE `Budget` MODIFY `category` ENUM('shopping','food','rent','utilities','transport','entertainment','health','other') NULL;
