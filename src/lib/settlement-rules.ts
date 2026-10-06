/**
 * Pure (DB-free) rules for settlements ("Quedar en paz"). All money is integer
 * CENTS. The DB side (locking, conditional updates, ledger posting) lives in
 * settlement-service.ts and applies these rules inside one transaction.
 */

import { formatCurrency } from './currency';

/** Sane upper bound for one payment: 1.000.000 € (also keeps Int columns safe). */
export const MAX_SETTLEMENT_CENTS = 100_000_000;

export const SETTLEMENT_METHODS = ['CASH', 'BIZUM', 'TRANSFER'] as const;
export type SettlementMethodValue = (typeof SETTLEMENT_METHODS)[number];

export function isSettlementMethod(value: unknown): value is SettlementMethodValue {
    return typeof value === 'string' && (SETTLEMENT_METHODS as readonly string[]).includes(value);
}

export type AmountResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * Validate an API amount given in EUROS. Only a real JSON number is accepted
 * (never '', [], true, '12'), it must round to at least 1 cent and stay under
 * MAX_SETTLEMENT_CENTS. Zero-amount "checkpoint" settlements no longer exist.
 */
export function parseSettlementAmount(value: unknown): AmountResult {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: 'El importe debe ser un número' };
    }
    const cents = Math.round(value * 100);
    if (cents < 1) return { ok: false, error: 'El importe debe ser de al menos 0,01 €' };
    if (cents > MAX_SETTLEMENT_CENTS) return { ok: false, error: 'El importe no puede superar 1.000.000 €' };
    return { ok: true, cents };
}

/**
 * The most `fromUserId` may pay `toUserId` without flipping anybody's sign:
 * no more than what the payer owes in total, and no more than what the receiver
 * is owed in total. In a couple this is exactly the debt between the two; in a
 * group it lets a debtor pay any creditor up to the smaller of both positions.
 * Balances are ledger nets (positive = is owed, negative = owes).
 */
export function settlementCap(fromBalance: number, toBalance: number): number {
    return Math.max(0, Math.min(-fromBalance, toBalance));
}

/** Typed failure of a settlement rule → JSON `{ error, code, ...extra }` with `status`. */
export class SettlementError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly extra: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = 'SettlementError';
    }

    toJSON() {
        return { error: this.message, code: this.code, ...this.extra };
    }
}

const eur = formatCurrency;

/** Reject a payment above the current debt between the pair (or when there is none). */
export function assertWithinCap(amountCents: number, cap: number): void {
    if (cap <= 0) {
        throw new SettlementError(409, 'NOTHING_TO_SETTLE',
            'Ahora mismo no hay ninguna deuda pendiente entre vosotros', { maxAmountCents: 0 });
    }
    if (amountCents > cap) {
        throw new SettlementError(409, 'SETTLEMENT_EXCEEDS_DEBT',
            `El pago (${eur(amountCents)}) supera la deuda pendiente (${eur(cap)})`,
            { maxAmountCents: cap });
    }
}
