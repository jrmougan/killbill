// Pure aggregation for the "Mes" tab (Presupuestos | Análisis). DB-free so the
// date logic can be unit-tested: every bucket is a half-open [start, end) month
// in Europe/Madrid (src/lib/month-range.ts), so a future-dated expense never
// leaks into "este mes" and every section adds up to the same total.

import { monthRange } from "@/lib/month-range";
import { monthShort } from "./format";

export type MonthBucket = { start: Date; end: Date };

/** The last `count` months, oldest → current, as Madrid half-open ranges. */
export function lastMonths(now: Date, count = 6): MonthBucket[] {
    return Array.from({ length: count }, (_, i) => monthRange(now, i - (count - 1)));
}

/** true when `date` falls in [start, end). */
export function inBucket(date: Date, b: MonthBucket): boolean {
    return date >= b.start && date < b.end;
}

export interface AggExpense {
    amount: number;
    date: Date;
    splits: { userId: string; amount: number }[];
}

/** My share of one expense: my split row, else an even share (old analytics rule). */
export function shareOf(e: AggExpense, userId: string, memberCount: number): number {
    const mine = e.splits.find((s) => s.userId === userId);
    return mine ? mine.amount : Math.floor(e.amount / (memberCount || 1));
}

export interface MonthSeriesPoint {
    label: string;
    total: number;
    count: number;
    /** Caller's share (shared scope only). */
    myShare: number | null;
}

/** Per-month totals / counts / my share over `buckets` (expenses outside are ignored). */
export function monthSeries<E extends AggExpense>(
    expenses: E[],
    buckets: MonthBucket[],
    opts: { userId: string; memberCount: number; shared: boolean },
): MonthSeriesPoint[] {
    return buckets.map((b) => {
        const inMonth = expenses.filter((e) => inBucket(e.date, b));
        return {
            label: monthShort(b.start),
            total: inMonth.reduce((s, e) => s + e.amount, 0),
            count: inMonth.length,
            myShare: opts.shared
                ? inMonth.reduce((s, e) => s + shareOf(e, opts.userId, opts.memberCount), 0)
                : null,
        };
    });
}

/**
 * Average monthly spend over the months that HAD spend (same rule as the old
 * analytics: empty months before the first expense do not drag it down).
 */
export function averageMonthly(series: { total: number }[]): number {
    const active = series.filter((m) => m.total > 0);
    if (active.length === 0) return 0;
    return Math.round(active.reduce((s, m) => s + m.total, 0) / active.length);
}

/**
 * How to label the month-over-month change:
 *  - `delta`  previous month had spend → percentage
 *  - `zero`   previous month was empty but an earlier one was not
 *  - `first`  no spend at all before this month
 */
export type MonthComparison =
    | { kind: "delta"; percent: number }
    | { kind: "zero" }
    | { kind: "first" };

export function compareWithPrevious(series: { total: number }[]): MonthComparison {
    const n = series.length;
    const current = series[n - 1]?.total ?? 0;
    const prev = series[n - 2]?.total ?? 0;
    if (prev > 0) return { kind: "delta", percent: Math.round(((current - prev) / prev) * 100) };
    return series.slice(0, Math.max(0, n - 2)).some((m) => m.total > 0) ? { kind: "zero" } : { kind: "first" };
}

/**
 * Caller's net balance in the space at the END of each bucket, from their
 * ledger entries (+ = they are owed). Entries dated after a bucket's end do not
 * count for it; the opening balance before the window is included.
 */
export function balanceAtMonthEnds(
    entries: { amount: number; postedAt: Date }[],
    buckets: MonthBucket[],
): { label: string; balance: number }[] {
    return buckets.map((b) => ({
        label: monthShort(b.start),
        balance: entries.reduce((s, e) => (e.postedAt < b.end ? s + e.amount : s), 0),
    }));
}

/** Budget usage state: ok (< 80 %), warn (≥ 80 %), over (> 100 %). */
export type BudgetState = "ok" | "warn" | "over";

export function budgetPercent(spent: number, amount: number): number {
    return amount > 0 ? Math.round((spent / amount) * 100) : 0;
}

export function budgetState(spent: number, amount: number): BudgetState {
    if (amount <= 0) return spent > 0 ? "over" : "ok";
    if (spent > amount) return "over";
    return spent * 100 >= amount * 80 ? "warn" : "ok";
}

/** Maximum budget the UI accepts (cents): 1.000.000 €. */
export const MAX_BUDGET_CENTS = 100_000_000;
