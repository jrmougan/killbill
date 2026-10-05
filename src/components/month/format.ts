// Pure presentation helpers for the "Mes" tab (Presupuestos | Análisis). DB-free
// and timezone-agnostic (they take the `now` they reason about) so they can be
// unit-tested and shared by the server page and the client views.

export type MonthView = "budget" | "analysis";
export type MonthScope = "shared" | "personal";

export function normalizeMonthView(raw: string | string[] | undefined): MonthView {
    const v = Array.isArray(raw) ? raw[0] : raw;
    return v === "analysis" ? "analysis" : "budget";
}

/** "octubre" → "Octubre". */
export function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Full month name, capitalised: "Octubre". */
export function monthName(date: Date): string {
    return capitalize(date.toLocaleDateString("es-ES", { month: "long" }));
}

/** Short lowercase month without the trailing dot ICU sometimes adds: "sept", "oct". */
export function monthShort(date: Date): string {
    return date.toLocaleDateString("es-ES", { month: "short" }).replace(/\.$/, "");
}

/** Days left in `now`'s month, counting today (Oct 5 → 27). Always ≥ 1. */
export function daysLeftInMonth(now: Date): number {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(1, last - now.getDate() + 1);
}

/**
 * Compact euro amount for budget rows ("25 / 100 €"): whole euros drop the
 * decimals, otherwise two decimals with the es-ES comma ("25,02").
 */
export function formatAmountShort(cents: number): string {
    const whole = cents % 100 === 0;
    return new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
    }).format(cents / 100);
}

/** Month-over-month change in whole percent; null when there is no previous spend. */
export function deltaPercent(current: number, previous: number): number | null {
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 100);
}

/** Share of `part` in `total` as a whole percent (0 when total is 0). */
export function sharePercent(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
}
