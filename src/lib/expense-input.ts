/**
 * Validation helpers shared by the expense write paths (POST/PATCH
 * /api/expenses, CSV import) and their forms. Pure — safe on client and server.
 */
import { addInterval } from '@/lib/recurring-interval';

/** Oldest accepted expense date (inclusive). */
export const MIN_EXPENSE_YEAR = 2000;
export const MIN_EXPENSE_DATE = `${MIN_EXPENSE_YEAR}-01-01`;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of `d` in UTC. */
function isoUTC(d: Date): string {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Latest accepted expense date (inclusive): today + 1 year. */
export function maxExpenseDateISO(now: Date = new Date()): string {
    const d = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
    return isoUTC(d);
}

/**
 * True when `iso` is a strict YYYY-MM-DD that names a REAL calendar day
 * (rejects 2026-02-31, 2026-13-01, 2025-02-29…). No range check.
 */
export function isRealCalendarDay(iso: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export type DateCheck = { ok: true } | { ok: false; error: string };

/** Real calendar day within [2000-01-01, today + 1 year]. Spanish error messages. */
export function checkExpenseDay(iso: string, now: Date = new Date()): DateCheck {
    if (!isRealCalendarDay(iso)) return { ok: false, error: `Fecha inválida: ${iso}` };
    if (iso < MIN_EXPENSE_DATE) return { ok: false, error: `La fecha no puede ser anterior al año ${MIN_EXPENSE_YEAR}` };
    if (iso > maxExpenseDateISO(now)) return { ok: false, error: 'La fecha no puede ser posterior a dentro de un año' };
    return { ok: true };
}

export type ParsedExpenseDate =
    | { ok: true; date: Date | undefined }
    | { ok: false; error: string };

/**
 * Parse the optional `date` field of an expense write ("YYYY-MM-DD").
 * Absent / null / "" → `date: undefined` (caller keeps now / the old date).
 * Stored at 12:00 UTC so the calendar day is stable in Europe/Madrid.
 */
export function parseExpenseDate(input: unknown, now: Date = new Date()): ParsedExpenseDate {
    if (input === undefined || input === null || input === '') return { ok: true, date: undefined };
    if (typeof input !== 'string') return { ok: false, error: 'Fecha inválida' };
    const check = checkExpenseDay(input, now);
    if (!check.ok) return check;
    return { ok: true, date: new Date(`${input}T12:00:00.000Z`) };
}

export const RECURRING_INTERVALS = ['weekly', 'monthly', 'yearly'] as const;
export type RecurringIntervalKey = (typeof RECURRING_INTERVALS)[number];

export function isRecurringInterval(v: unknown): v is RecurringIntervalKey {
    return typeof v === 'string' && (RECURRING_INTERVALS as readonly string[]).includes(v);
}

/**
 * Next run of a recurring series anchored on the EXPENSE date (G-12): the
 * first occurrence after `expenseDate` that is still in the future. A template
 * dated 15/09 (monthly) entered on 06/10 next runs 15/10 — not 06/11 — and an
 * old template does not back-fill occurrences the user never asked for.
 */
export function nextRecurringRun(expenseDate: Date, interval: RecurringIntervalKey, now: Date = new Date()): Date {
    let next = addInterval(expenseDate, interval);
    for (let i = 0; i < 1000 && next.getTime() <= now.getTime(); i++) next = addInterval(next, interval);
    return next;
}
