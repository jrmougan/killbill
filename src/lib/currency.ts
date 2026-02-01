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
 * Formats cents as a localized EUR currency string.
 * Example: 1050 → "10,50 €"
 */
export function formatCurrency(cents: number, locale: string = 'es-ES'): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
    }).format(toEuros(cents));
}
