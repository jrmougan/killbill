// Serializable props shared by the "Mes" server page and its client views.
// Every amount is in CENTS (format with src/lib/currency.ts at render time).

/** A budget of the current month with the spend of its category (cents). */
export interface BudgetEntry {
    id: string;
    /** Effective category key (relational categoryRef.key, enum fallback). */
    category: string;
    amount: number;
    spent: number;
}

/** A category of the effective set, as the Mes views render it. */
export interface MonthCategory {
    key: string;
    label: string;
    emoji: string;
    iconName: string;
    hex: string;
}

export interface MonthAnalysis {
    /** Last 6 months, oldest → current ("may" … "oct"), Madrid half-open months. */
    months: { label: string; total: number; count: number; myShare: number | null }[];
    /** Current month spend per category, largest first (sums to the month total). */
    byCategory: (MonthCategory & { amount: number })[];
    /** Caller's share of the current month (shared scope only). */
    myShare: number | null;
    /** Month-over-month comparison for the headline. */
    comparison: { kind: "delta"; percent: number } | { kind: "zero" } | { kind: "first" };
    kpis: {
        /** Average of the months with spend in the 6-month window (cents). */
        avgMonthly: number;
        /** Number of expenses this month. */
        count: number;
        /** Label of the biggest category this month, null when no spend. */
        topCategory: string | null;
    };
    /** Caller's balance at the end of each month (shared scope only, + = owed). */
    balance: { label: string; balance: number }[] | null;
    topExpenses: { id: string; description: string; category: string; amount: number; date: string }[];
    topItems: { name: string; total: number; count: number }[];
}
