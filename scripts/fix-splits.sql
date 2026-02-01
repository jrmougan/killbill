-- Fix splits where rounding caused issues during migration
-- MySQL doesn't allow UPDATE with subquery on same table, so we use a JOIN approach

-- For ALL splits on expenses with 2 participants, set each split to expense.amount / 2
UPDATE Split s
INNER JOIN Expense e ON s.expenseId = e.id
INNER JOIN (
    SELECT expenseId 
    FROM Split 
    GROUP BY expenseId 
    HAVING COUNT(*) = 2
) AS paired ON paired.expenseId = e.id
SET s.amount = ROUND(e.amount / 2);
