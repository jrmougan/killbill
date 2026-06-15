-- Convert Budget.category from a free-form String to the ExpenseCategory enum
-- so budgets are integrity-constrained and match Expense.category for spend tracking.
ALTER TABLE `Budget` MODIFY `category` ENUM('shopping', 'food', 'rent', 'utilities', 'transport', 'entertainment', 'health', 'other') NOT NULL;
