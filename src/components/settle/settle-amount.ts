// Amount field of a payment (/settle review sheet and /settle/[id]/edit):
// strict es-ES text → cents, with the same messages on both screens.

import { formatCurrency, parseEuroInput } from "@/lib/currency";
import { MAX_SETTLEMENT_CENTS } from "@/lib/settlement-rules";

export type SettleAmountCheck = { cents: number | null; error: string | null };

/**
 * Strict es-ES amount → cents, or an error message for the field. `maxCents`
 * is the debt being settled: above it the field says so instead of letting
 * the API answer 409 SETTLEMENT_EXCEEDS_DEBT.
 */
export function validateSettleAmount(text: string, maxCents?: number): SettleAmountCheck {
    if (!text.trim()) return { cents: null, error: "Escribe un importe" };
    const cents = parseEuroInput(text);
    if (cents === null) return { cents: null, error: "Importe no válido. Usa, por ejemplo, 12,50" };
    if (cents < 1) return { cents: null, error: "El importe debe ser de al menos 0,01 €" };
    if (cents > MAX_SETTLEMENT_CENTS) return { cents: null, error: "El importe no puede superar 1.000.000 €" };
    if (maxCents !== undefined && cents > maxCents) {
        return { cents: null, error: `No puede ser más de ${formatCurrency(maxCents)}, lo que queda por saldar` };
    }
    return { cents, error: null };
}

/** Cents → the editable field text ("12,50"). */
export function settleAmountText(cents: number): string {
    return (cents / 100).toFixed(2).replace(".", ",");
}
