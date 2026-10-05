import { describe, it, expect } from 'vitest';
import { calculateSplitAmounts } from './splits';

/**
 * Pinning tests for the Phase 4 CHECK-constraint migration
 * (prisma/migrations/20260708220000_phase4_check_constraints).
 *
 * These document WHY the migration adds CHECK constraints on Expense/Settlement/
 * Budget amounts but deliberately OMITS a `Split.amount >= 0` constraint:
 *
 *  1. The ITEMIZED diff-adjust (splits.ts:86, `splits[0].amount += diff`) can
 *     drive the first split NEGATIVE through a live, unguarded write path when
 *     the entered total is far below the receipt items' sum. A `Split.amount`
 *     CHECK would turn that currently-succeeding write into a 500. The constraint
 *     may only be added AFTER that path is clamped/validated in code — at which
 *     point test (1) must be flipped to expect the clamp/rejection.
 *
 *  2. Zero splits are legitimate (a 1-cent EQUAL split yields a 0 for the second
 *     member), so any future Split CHECK must be `>= 0`, never `> 0`.
 */
describe('split amounts — CHECK-constraint boundary conditions', () => {
    it('ITEMIZED mismatch is rescaled proportionally — no negative split (G-03)', () => {
        // 1€ expense, but an exclusive 100€ item assigned to u2: the receipt items
        // sum to 10000c, far above amountCents=100. The diff used to land on
        // splits[0] (u1 → -9900); it is now spread proportionally, so u2 (the
        // only one with a share) carries the whole 1€ and nobody goes negative.
        // Mixed-sign promotion lines can still fall back to the first-member
        // adjust, so the Split.amount CHECK stays omitted.
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
});
