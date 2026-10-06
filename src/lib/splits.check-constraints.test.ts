import { describe, it, expect } from 'vitest';
import { calculateSplitAmounts, calculateSplitAmountsFromLines, rescaleSplits } from './splits';

/**
 * Pinning tests for the DB CHECK constraints on money columns:
 * prisma/migrations/20260708220000_phase4_check_constraints (Expense/Settlement/
 * Budget amounts) and 20261006110001_scope_check_constraints, which adds
 * `chk_split_amount_nonneg` (Split.amount >= 0).
 *
 *  1. No split producer may return a NEGATIVE share for a positive amount — not
 *     even with a promotion line (negative total) assigned to one member — or the
 *     write would 500 on the CHECK. A negative share is clamped to 0 and the rest
 *     rescaled so the split still sums exactly to the amount.
 *  2. Zero splits are legitimate (a 1-cent EQUAL split yields a 0 for the second
 *     member), so the Split CHECK is `>= 0`, never `> 0`.
 */
describe('split amounts — CHECK-constraint boundary conditions', () => {
    it('ITEMIZED mismatch is rescaled proportionally — no negative split (G-03)', () => {
        // 1€ expense, but an exclusive 100€ item assigned to u2: the receipt items
        // sum to 10000c, far above amountCents=100. The diff used to land on
        // splits[0] (u1 → -9900); it is now spread proportionally, so u2 (the
        // only one with a share) carries the whole 1€ and nobody goes negative.
        const splits = calculateSplitAmounts(
            100,
            [{ total: 100, assignedTo: 'u2' }],
            [{ id: 'u1' }, { id: 'u2' }],
        );
        expect(splits.map((s) => s.amount)).toEqual([0, 100]);
        expect(splits.every((s) => s.amount >= 0)).toBe(true);
        expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(100);
    });

    it('ITEMIZED amount raised after itemizing keeps each share proportional', () => {
        // Lines 6,75 € (me 5,07 €, partner 1,68 €) but the amount is typed as 20 €.
        const splits = calculateSplitAmounts(
            2000,
            [{ total: 3.39, assignedTo: 'u1' }, { total: 3.36, assignedTo: null }],
            [{ id: 'u1' }, { id: 'u2' }],
        );
        expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(2000);
        // u2 owned 168/675 of the lines → ~498c of 2000, not 1493c.
        expect(splits[1].amount).toBe(Math.floor((168 * 2000) / 675));
    });

    it('EQUAL split of 1 cent across 2 members yields [1, 0] (zero splits are legitimate)', () => {
        const splits = calculateSplitAmounts(1, null, [{ id: 'u1' }, { id: 'u2' }]);
        expect(splits.map((s) => s.amount)).toEqual([1, 0]);
    });

    it('a promotion line assigned to someone never yields a negative split (CHECK Split.amount >= 0)', () => {
        // Common 2€ (1€ each) + a -5€ discount assigned to u2 → u2 would be -4€.
        const items = [{ total: 2, assignedTo: null }, { total: -5, assignedTo: 'u2' }];
        const members = [{ id: 'u1' }, { id: 'u2' }];
        for (const amount of [100, 200, 1500]) {
            const euro = calculateSplitAmounts(amount, items, members);
            expect(euro.every((s) => s.amount >= 0)).toBe(true);
            expect(euro.reduce((s, x) => s + x.amount, 0)).toBe(amount);
            const lines = calculateSplitAmountsFromLines(
                amount,
                items.map((i) => ({ lineTotal: Math.round(i.total * 100), assignedToId: i.assignedTo })),
                members,
            );
            expect(lines).toEqual(euro);
        }
    });

    it('rescaleSplits clamps negative persisted shares before rescaling', () => {
        const out = rescaleSplits([{ userId: 'a', amount: -300 }, { userId: 'b', amount: 1300 }], 1000);
        expect(out).toEqual([{ userId: 'a', amount: 0 }, { userId: 'b', amount: 1000 }]);
    });
});
