/**
 * Amount entry rules for the add-expense numpad (pure).
 *
 * The amount is kept as the es-ES string the user sees ("43,85"): comma decimal
 * separator, at most 2 decimals and at most 6 integer digits (≤ 999.999,99 €,
 * the API's ceiling). Conversion to cents happens once, in {@link amountToCents}.
 */

export const MAX_INT_DIGITS = 6;
export const MAX_DECIMALS = 2;

export type AmountKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "," | "del";

/** Apply one numpad / keyboard key to the current amount string. */
export function applyAmountKey(prev: string, key: AmountKey): string {
    if (key === "del") return prev.slice(0, -1);
    if (key === ",") {
        if (prev.includes(",")) return prev;
        return (prev === "" ? "0" : prev) + ",";
    }
    const [int, dec] = prev.split(",");
    if (dec !== undefined) {
        return dec.length >= MAX_DECIMALS ? prev : prev + key;
    }
    if (int === "0") return key; // no leading zeros
    if (int.length >= MAX_INT_DIGITS) return prev;
    return prev + key;
}

/**
 * Normalise free typing / pasting (physical keyboard, tests filling "25.50")
 * by replaying it through the same key rules — so both paths obey one policy.
 */
export function sanitizeAmount(raw: string): string {
    let out = "";
    for (const ch of raw) {
        if (ch >= "0" && ch <= "9") out = applyAmountKey(out, ch as AmountKey);
        else if (ch === "," || ch === ".") out = applyAmountKey(out, ",");
    }
    return out;
}

/** "43,85" → 4385. Empty/invalid → 0. Never goes through floats beyond 2 decimals. */
export function amountToCents(amount: string): number {
    if (!amount) return 0;
    const [int, dec = ""] = amount.split(",");
    const euros = parseInt(int || "0", 10);
    const cents = parseInt((dec + "00").slice(0, 2), 10);
    if (!Number.isFinite(euros) || !Number.isFinite(cents)) return 0;
    return euros * 100 + cents;
}

/** 4385 → "43,85" (numpad string form; integers keep no decimals: 1200 → "12"). */
export function centsToAmount(cents: number): string {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    const euros = Math.floor(cents / 100);
    const rest = cents % 100;
    return rest === 0 ? String(euros) : `${euros},${String(rest).padStart(2, "0")}`;
}
