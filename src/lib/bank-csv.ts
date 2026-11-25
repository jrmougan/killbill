/**
 * Bank CSV import (decouple F2) — pure normalization of a parsed CSV row into a
 * personal-expense draft. Dependency-free so it is unit-testable and shared by
 * the client (papaparse does the raw parsing) and any server validation.
 *
 * A generic importer: the user maps their bank's columns + formats to this shape,
 * so no per-bank parser is hardcoded.
 */
import { checkExpenseDay, isRealCalendarDay } from './expense-input';

export type DateFormat = 'DMY' | 'YMD' | 'MDY';

export interface ColumnMapping {
    dateCol: string;         // header name of the transaction-date column
    amountCol: string;       // header name of the amount column
    descriptionCol: string;  // header name of the concept/description column
    dateFormat: DateFormat;  // order of day/month/year (separator auto: / or - or .)
    decimalSep: ',' | '.';   // decimal separator used by the bank
    expenseSign: 'negative' | 'positive'; // which sign marks an OUTFLOW (expense)
}

export interface NormalizedRow {
    dateISO: string;      // YYYY-MM-DD (local calendar date, no timezone shift)
    amountCents: number;  // POSITIVE magnitude in cents
    description: string;
    isExpense: boolean;   // true when the signed amount is an outflow per expenseSign
    error?: string;       // set when the row could not be parsed (never imported)
}

/** Parse a date string in the given field order. Returns YYYY-MM-DD or null. */
export function parseDateISO(value: string, format: DateFormat): string | null {
    const parts = value.trim().split(/[/\-.]/).map((p) => p.trim());
    if (parts.length !== 3) return null;
    let day: string, month: string, year: string;
    if (format === 'DMY') [day, month, year] = parts;
    else if (format === 'YMD') [year, month, day] = parts;
    else [month, day, year] = parts; // MDY
    if (year.length === 2) year = `20${year}`;
    const d = Number(day), mo = Number(month), y = Number(year);
    if (!Number.isInteger(d) || !Number.isInteger(mo) || !Number.isInteger(y)) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 3000) return null;
    const iso = `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    // Real calendar day only (G-06): 31/02 must not roll over to 3 March.
    return isRealCalendarDay(iso) ? iso : null;
}

/**
 * Parse a money string into SIGNED cents. Handles the bank's decimal separator,
 * thousands separators, a leading/trailing minus, and parentheses-for-negative.
 * Returns null if not a number.
 */
export function parseSignedCents(value: string, decimalSep: ',' | '.'): number | null {
    let s = value.trim();
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (s.includes('-')) { negative = true; }
    // Keep only digits and separators.
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return null;
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandsSep).join('');          // strip thousands separators
    s = s.replace(decimalSep, '.');              // normalize decimal to '.'
    const euros = Number(s);
    if (!Number.isFinite(euros)) return null;
    const cents = Math.round(euros * 100) * (negative ? -1 : 1);
    return cents;
}

/** Normalize one parsed CSV row (header->value map) into an expense draft. */
export function normalizeRow(raw: Record<string, string>, m: ColumnMapping): NormalizedRow {
    const rawDate = raw[m.dateCol] ?? '';
    const rawAmount = raw[m.amountCol] ?? '';
    const description = (raw[m.descriptionCol] ?? '').trim();

    const dateISO = parseDateISO(rawDate, m.dateFormat);
    const signedCents = parseSignedCents(rawAmount, m.decimalSep);

    if (!dateISO) return { dateISO: '', amountCents: 0, description, isExpense: false, error: `Fecha inválida: "${rawDate}"` };
    // Same accepted range as the expenses API ([2000-01-01, today + 1 year]).
    const inRange = checkExpenseDay(dateISO);
    if (!inRange.ok) return { dateISO, amountCents: 0, description, isExpense: false, error: inRange.error };
    if (signedCents === null) return { dateISO, amountCents: 0, description, isExpense: false, error: `Importe inválido: "${rawAmount}"` };
    if (!description) return { dateISO, amountCents: Math.abs(signedCents), description, isExpense: false, error: 'Concepto vacío' };

    const isExpense = m.expenseSign === 'negative' ? signedCents < 0 : signedCents > 0;
    return { dateISO, amountCents: Math.abs(signedCents), description, isExpense };
}

type GuessedColumns = Pick<ColumnMapping, 'dateCol' | 'amountCol' | 'descriptionCol'>;

// Header patterns per field, strongest first. Bank headers are verbose
// ("Fecha operación contable del movimiento", "Concepto detallado del cargo"),
// so weak amount words (cargo/movimiento/euro) only apply after every field had
// its strong pass, and a column is never assigned to two fields.
const COLUMN_PATTERNS: Record<keyof GuessedColumns, RegExp[]> = {
    dateCol: [/fecha|date/i],
    descriptionCol: [/concepto|descrip|concept|detalle|beneficiario/i],
    amountCol: [/importe|amount|cantidad/i, /euro|\beur\b|cargo|movimiento/i],
};
// A running balance is never the movement amount.
const NOT_AMOUNT = /saldo|balance/i;

/** Best-effort guess of the date/amount/description columns from the CSV headers. */
export function guessColumns(headers: string[]): GuessedColumns {
    const fields = Object.keys(COLUMN_PATTERNS) as (keyof GuessedColumns)[];
    const picked: Partial<GuessedColumns> = {};
    const used = new Set<string>();
    const levels = Math.max(...fields.map((f) => COLUMN_PATTERNS[f].length));
    for (let level = 0; level < levels; level++) {
        for (const field of fields) {
            const re = COLUMN_PATTERNS[field][level];
            if (picked[field] !== undefined || !re) continue;
            const hit = headers.find((h) => !used.has(h) && re.test(h) && !(field === 'amountCol' && NOT_AMOUNT.test(h)));
            if (hit !== undefined) { picked[field] = hit; used.add(hit); }
        }
    }
    // Unmatched fields fall back to the first still-free column (the user can remap).
    for (const field of fields) {
        if (picked[field] !== undefined) continue;
        const free = headers.find((h) => !used.has(h)) ?? headers[0] ?? '';
        picked[field] = free;
        used.add(free);
    }
    return picked as GuessedColumns;
}
