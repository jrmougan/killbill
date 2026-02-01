-- Fix splits where rounding caused issues during migration
-- The migration used ROUND() which doesn't work correctly for .50 values
-- We need to recalculate splits based on the parent expense amount

-- For expenses with 2 splits (50/50), each split should be exactly expense.amount / 2
UPDATE Split s
JOIN Expense e ON s.expenseId = e.id
SET s.amount = ROUND(e.amount / 2)
WHERE e.id IN (
    SELECT expenseId FROM Split GROUP BY expenseId HAVING COUNT(*) = 2
);
