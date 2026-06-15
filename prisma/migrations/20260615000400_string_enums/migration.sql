-- Convert free-form String columns to MySQL ENUMs for data integrity.
-- Order matters: normalize any out-of-vocabulary existing rows FIRST,
-- then MODIFY the column type. Otherwise the ALTER would fail (strict mode)
-- or silently coerce unknown values to '' / NULL.

-- ---------------------------------------------------------------------------
-- Expense.category  ->  ENUM('shopping','food','rent','utilities','transport',
--                            'entertainment','health','other') NOT NULL DEFAULT 'other'
-- ---------------------------------------------------------------------------
UPDATE `Expense`
SET `category` = 'other'
WHERE `category` IS NULL
   OR `category` NOT IN ('shopping','food','rent','utilities','transport','entertainment','health','other');

ALTER TABLE `Expense`
    MODIFY `category` ENUM('shopping','food','rent','utilities','transport','entertainment','health','other') NOT NULL DEFAULT 'other';

-- ---------------------------------------------------------------------------
-- Expense.recurringInterval  ->  ENUM('weekly','monthly','yearly') NULL
-- ---------------------------------------------------------------------------
-- Any value that is not a recognized interval (e.g. legacy 'daily' or junk)
-- is reset to NULL so the column can be narrowed safely.
UPDATE `Expense`
SET `recurringInterval` = NULL
WHERE `recurringInterval` IS NOT NULL
  AND `recurringInterval` NOT IN ('weekly','monthly','yearly');

ALTER TABLE `Expense`
    MODIFY `recurringInterval` ENUM('weekly','monthly','yearly') NULL;

-- ---------------------------------------------------------------------------
-- Settlement.status  ->  ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING'
-- ---------------------------------------------------------------------------
UPDATE `Settlement`
SET `status` = 'PENDING'
WHERE `status` IS NULL
   OR `status` NOT IN ('PENDING','CONFIRMED','REJECTED');

ALTER TABLE `Settlement`
    MODIFY `status` ENUM('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING';

-- ---------------------------------------------------------------------------
-- Settlement.method  ->  ENUM('CASH','BIZUM','TRANSFER') NOT NULL DEFAULT 'CASH'
-- ---------------------------------------------------------------------------
UPDATE `Settlement`
SET `method` = 'CASH'
WHERE `method` IS NULL
   OR `method` NOT IN ('CASH','BIZUM','TRANSFER');

ALTER TABLE `Settlement`
    MODIFY `method` ENUM('CASH','BIZUM','TRANSFER') NOT NULL DEFAULT 'CASH';
