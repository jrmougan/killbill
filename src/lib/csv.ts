/**
 * CSV field helpers shared by export endpoints.
 */

// Characters that, when they lead a cell, can make a spreadsheet (Excel, Sheets,
// LibreOffice) interpret the cell as a formula — the CSV-injection vector.
const FORMULA_LEADERS = /^[=+\-@\t\r]/;

/**
 * Escapes a value for inclusion in a CSV cell.
 *
 * - Neutralizes CSV/formula injection by prefixing a single quote when the value
 *   starts with a formula-triggering character (=, +, -, @, tab, CR).
 * - Quotes (RFC 4180) the field when it contains a comma, quote, CR or LF,
 *   doubling any embedded quotes.
 */
export function escapeCsvField(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    let str = String(value);

    if (FORMULA_LEADERS.test(str)) {
        str = `'${str}`;
    }

    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}
