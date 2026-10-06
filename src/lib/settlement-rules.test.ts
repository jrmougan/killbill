import { describe, it, expect } from 'vitest';
import { assertWithinCap, MAX_SETTLEMENT_CENTS, parseSettlementAmount, settlementCap, SettlementError } from './settlement-rules';

describe('parseSettlementAmount', () => {
    it('accepts real numbers ≥ 1 cent and ≤ 1.000.000 €, in cents', () => {
        expect(parseSettlementAmount(12.5)).toEqual({ ok: true, cents: 1250 });
        expect(parseSettlementAmount(0.01)).toEqual({ ok: true, cents: 1 });
        expect(parseSettlementAmount(0.005)).toEqual({ ok: true, cents: 1 });
        expect(parseSettlementAmount(1_000_000)).toEqual({ ok: true, cents: MAX_SETTLEMENT_CENTS });
    });

    it.each([0, -1, 0.004, 1_000_000.01, 1e12, NaN, Infinity, '', '12', [], true, null, undefined, {}])('rejects %j', (v) => {
        expect(parseSettlementAmount(v).ok).toBe(false);
    });
});

describe('settlementCap', () => {
    it('couple: exactly the debt; never negative', () => {
        expect(settlementCap(-5000, 5000)).toBe(5000);
        expect(settlementCap(5000, -5000)).toBe(0);
        expect(settlementCap(0, 0)).toBe(0);
    });
    it('group: min of what the payer owes and what the receiver is owed', () => {
        expect(settlementCap(-5000, 1000)).toBe(1000);
        expect(settlementCap(-500, 4000)).toBe(500);
    });
});

describe('assertWithinCap', () => {
    it('409 NOTHING_TO_SETTLE / SETTLEMENT_EXCEEDS_DEBT with the max', () => {
        expect(() => assertWithinCap(100, 0)).toThrow(SettlementError);
        let err: SettlementError | null = null;
        try {
            assertWithinCap(6000, 5000);
        } catch (e) {
            err = e as SettlementError;
        }
        expect(err?.status).toBe(409);
        expect(err?.toJSON()).toMatchObject({ code: 'SETTLEMENT_EXCEEDS_DEBT', maxAmountCents: 5000 });
        expect(() => assertWithinCap(5000, 5000)).not.toThrow();
    });
});
