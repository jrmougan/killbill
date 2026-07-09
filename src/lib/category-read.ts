/**
 * Phase 4 read-switch (2b): the Category TABLE is the effective read key for
 * server-side grouping/filtering by category.
 *
 * `categoryRef.key` (joined via Expense.categoryId / Budget.categoryId) wins;
 * the legacy `category` enum column is only a fallback for rows whose
 * categoryId is still NULL (not yet backfilled, or a deleted custom category —
 * the FK has no cascade, but defensive fallback keeps reads total).
 *
 * Today this is behavior-identical to reading the enum: every live row is
 * backfilled + dual-written and the 8 system Category rows mirror the
 * ExpenseCategory enum key-for-key. Once group-custom categories exist, the
 * table key diverges from (and supersedes) the enum.
 *
 * Pure on purpose: server pages, API routes and unit tests all share it
 * without pulling in Prisma.
 */
export interface CategoryKeyed {
    /**
     * Legacy ExpenseCategory enum value. Nullable since Phase 5 stopped writing
     * Budget.category (new Budget rows carry NULL here); the categoryRef.key wins
     * and 'other' is the final fallback, so a null enum is always safe.
     */
    category?: string | null;
    /** Joined relational category (select at least { key }). */
    categoryRef?: { key: string } | null;
}

/** Effective category key of a row: relational key, else enum, else 'other'. */
export function categoryKeyOf(row: CategoryKeyed): string {
    return row.categoryRef?.key ?? row.category ?? "other";
}

/**
 * Prisma `include`/`select` fragment for the relational category key. Spread it
 * into any Expense/Budget query whose result is grouped by category.
 */
export const CATEGORY_REF_SELECT = { categoryRef: { select: { key: true } } } as const;
