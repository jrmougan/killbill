/**
 * Currency utilities for cents-based arithmetic.
 * All amounts in the database are stored as integers (cents).
 * 1050 cents = 10.50€
 */

/**
 * Converts euros (float) to cents (int).
 * Use when saving user input to the database.
 */
export function toCents(euros: number): number {
    return Math.round(euros * 100);
}

/**
 * Converts cents (int) to euros (float).
 * Use when displaying data from the database.
 */
export function toEuros(cents: number): number {
    return cents / 100;
}

/**
 * Parses a user-typed amount string into a number.
 * es-ES users type the decimal separator as a comma, so strip everything
 * except digits and separators, normalise the comma to a dot, and return 0
 * for empty/invalid input (never NaN).
 * Example: "12,50" → 12.5
 */
export function parseAmountInput(input: string): number {
    const cents = parseEuroInput(input);
    return cents === null ? 0 : cents / 100;
}

/**
 * Strict es-ES money parser → integer CENTS, or `null` when the text is not an
 * unambiguous amount (so callers can show an error instead of silently saving
 * something else). Accepts "12", "12,5", "12,50", "12.50", "1.234,56",
 * "1,234.56", "1.234" (thousands, es-ES), "1 234,56 €". Rejects more than two
 * decimals, malformed grouping ("1.2.3", "1,2,3"), signs and letters.
 */
export function parseEuroInput(input: string): number | null {
    const raw = input.replace(/[\s\u00a0€]/g, '');
    if (!raw || !/^[0-9.,]+$/.test(raw)) return null;
    const lastComma = raw.lastIndexOf(','), lastDot = raw.lastIndexOf('.');
    let intPart = raw, decPart = '';
    const split = (sep: string, thousands: string) => {
        const i = raw.lastIndexOf(sep);
        intPart = raw.slice(0, i);
        decPart = raw.slice(i + 1);
        if (decPart.includes(thousands) || decPart.includes(sep)) return false;
        return groupedOk(intPart, thousands);
    };
    if (lastComma >= 0 && lastDot >= 0) {
        // Both present: the LAST one is the decimal separator.
        const ok = lastComma > lastDot ? split(',', '.') : split('.', ',');
        if (!ok) return null;
    } else if (lastComma >= 0 || lastDot >= 0) {
        const sep = lastComma >= 0 ? ',' : '.';
        const count = raw.split(sep).length - 1;
        const tail = raw.slice(raw.lastIndexOf(sep) + 1);
        if (count > 1 || (sep === '.' && tail.length === 3 && raw.indexOf(sep) <= 3 && raw.indexOf(sep) > 0)) {
            // "1.234" / "1.234.567" / "1,234,567" → thousands grouping only.
            if (!groupedOk(raw, sep)) return null;
            intPart = raw.split(sep).join('');
        } else {
            intPart = raw.slice(0, raw.lastIndexOf(sep));
            decPart = tail;
        }
    }
    intPart = intPart.replace(/[.,]/g, '');
    if (decPart.length > 2 || (!intPart && !decPart)) return null;
    const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
    return Number.isSafeInteger(cents) ? cents : null;
}

/** "1.234.567" style grouping: first group 1–3 digits, the rest exactly 3. */
function groupedOk(intPart: string, sep: string): boolean {
    if (!intPart.includes(sep)) return /^[0-9]*$/.test(intPart);
    const groups = intPart.split(sep);
    return /^[0-9]{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^[0-9]{3}$/.test(g));
}

/**
 * Formats a number as the value for a decimal text input, using a comma as
 * the decimal separator (es-ES). Round-trips with parseAmountInput.
 * Example: 2.5 → "2,5"
 */
export function formatAmountInput(value: number): string {
    return Number.isFinite(value) ? String(value).replace('.', ',') : '';
}

/**
 * Formats cents as a localized EUR currency string.
 * Example: 1050 → "10,50 €"
 */
export function formatCurrency(cents: number, locale: string = 'es-ES'): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
    }).format(toEuros(cents));
}

/**
 * Formats an amount that is already in euros as a localized EUR currency string.
 * Use for values that have already been converted out of cents (e.g. chart data).
 * Example: 10.5 → "10,50 €"
 */
export function formatEuros(euros: number, locale: string = 'es-ES'): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
    }).format(euros);
}
