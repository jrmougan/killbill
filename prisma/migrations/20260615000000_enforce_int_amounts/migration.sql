-- The check_sync migration created these amount columns as DOUBLE, which lets the
-- "all monetary amounts are integer cents" invariant break at the database level on a
-- fresh `migrate deploy`. Force them back to INTEGER. This is a no-op where the column
-- is already INT (e.g. dev DBs created via db push); on a DOUBLE column it converts the
-- stored whole-cent values without loss.
ALTER TABLE `Expense` MODIFY `amount` INTEGER NOT NULL;
ALTER TABLE `Split` MODIFY `amount` INTEGER NOT NULL;
ALTER TABLE `Settlement` MODIFY `amount` INTEGER NOT NULL;
