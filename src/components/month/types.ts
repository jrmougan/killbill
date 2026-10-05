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
    /** Last 6 months, oldest → current ("may" … "oct"). */
    months: { label: string; total: number }[];
    /** Current month spend per category, largest first. */
    byCategory: (MonthCategory & { amount: number })[];
    /** Caller's share of the current month (shared scope only). */
    myShare: number | null;
    topExpenses: { id: string; description: string; category: string; amount: number; date: string }[];
    topItems: { name: string; total: number; count: number }[];
}
