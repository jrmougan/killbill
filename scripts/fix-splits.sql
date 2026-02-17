-- Fix existing splits where odd cent amounts were double-rounded up
-- For all 50/50 split expenses (2 splits), recalculate:
-- First person gets FLOOR(amount/2) + remainder, second gets FLOOR(amount/2)

-- Step 1: Create temp table with correct values
CREATE TEMPORARY TABLE split_fix AS
SELECT 
    s.id AS split_id,
    e.id AS expense_id,
    s.userId,
    e.amount AS expense_amount,
    FLOOR(e.amount / 2) AS base_amount
FROM Split s
INNER JOIN Expense e ON s.expenseId = e.id
INNER JOIN (
    SELECT expenseId 
    FROM Split 
    GROUP BY expenseId 
    HAVING COUNT(*) = 2
) AS paired ON paired.expenseId = e.id;

-- Step 2: Update all splits to floor value first
UPDATE Split s
INNER JOIN split_fix sf ON sf.split_id = s.id
SET s.amount = sf.base_amount;

-- Step 3: For each expense with odd amount, add 1 cent to the first split
UPDATE Split s
INNER JOIN (
    SELECT MIN(s2.id) AS first_split_id, e2.id AS expense_id
    FROM Split s2
    INNER JOIN Expense e2 ON s2.expenseId = e2.id
    WHERE e2.amount % 2 = 1
    GROUP BY e2.id
    HAVING COUNT(*) = 2
) AS odd_exp ON odd_exp.first_split_id = s.id
SET s.amount = s.amount + 1;

DROP TEMPORARY TABLE split_fix;
