/**
 * Shopping-item quantity: optional, positive, up to 3 decimals (weighed goods:
 * "1,5 kg", "0,25 L") and at most MAX_QUANTITY. Shared by the item editor (to
 * show an inline error instead of silently truncating) and list-crud (the API
 * accepts a number or the same typed text, e.g. from the MCP tool). Pure / DB-free.
 */

export const MAX_QUANTITY = 100000;
const MAX_DECIMALS = 3;

export type QuantityResult = { ok: true; value: number | null } | { ok: false; error: string };

const INVALID = "La cantidad debe ser un número mayor que 0 (p. ej. 2 o 1,5)";
const TOO_BIG = "La cantidad máxima es 100.000";
const TOO_PRECISE = "La cantidad admite como mucho 3 decimales";

function checkNumber(n: number): QuantityResult {
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: INVALID };
    if (n > MAX_QUANTITY) return { ok: false, error: TOO_BIG };
    const rounded = Math.round(n * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS;
    if (Math.abs(rounded - n) > 1e-9) return { ok: false, error: TOO_PRECISE };
    return { ok: true, value: rounded };
}

/**
 * Parse a quantity typed by a person: "2", "1,5", "1.5", " 0,25 " → number;
 * "" → null (no quantity). Garbage ("abc", "1,5,2", "-1", "1e3") is rejected —
 * never coerced or truncated. Thousands separators are not accepted (a list
 * quantity is never "1.000").
 */
export function parseQuantityInput(text: string): QuantityResult {
    const t = text.trim();
    if (t === "") return { ok: true, value: null };
    if (!/^\d{1,6}([.,]\d+)?$/.test(t)) return { ok: false, error: INVALID };
    const [, dec = ""] = t.split(/[.,]/);
    if (dec.length > MAX_DECIMALS) return { ok: false, error: TOO_PRECISE };
    return checkNumber(Number(t.replace(",", ".")));
}

/** API side: accept a JSON number or the same text a person would type. */
export function normalizeQuantity(raw: unknown): QuantityResult {
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
    if (typeof raw === "number") return checkNumber(raw);
    if (typeof raw === "string") return parseQuantityInput(raw);
    return { ok: false, error: INVALID };
}

/** "1.5" → "1,5" for display/editing (es-ES decimal comma). */
export function formatQuantity(q: number): string {
    return String(q).replace(".", ",");
}
