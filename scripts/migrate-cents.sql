-- Migrate Float values to Int (cents × 100)
-- Run this AFTER prisma db push but BEFORE using the app

-- Migrate Expenses
UPDATE Expense SET amount = ROUND(amount * 100);

-- Migrate Splits  
UPDATE Split SET amount = ROUND(amount * 100);

-- Migrate Settlements
UPDATE Settlement SET amount = ROUND(amount * 100);
