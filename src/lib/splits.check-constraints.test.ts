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
    it('ITEMIZED diff-adjust can drive splits[0] NEGATIVE (why Split.amount has no CHECK yet)', () => {
        // 1€ expense, but an exclusive 100€ item assigned to u2: the receipt items
        // sum to 10000c, far above amountCents=100. The diff (-9900) lands on
        // splits[0] at splits.ts:86, so u1's split is negative.
        const splits = calculateSplitAmounts(
            100,
            [{ total: 100, assignedTo: 'u2' }],
            [{ id: 'u1' }, { id: 'u2' }],
        );
        expect(splits[0].amount).toBe(-9900);
        expect(splits[0].amount).toBeLessThan(0);
        // The set still sums to the (small) total — the negativity is the artifact.
        expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(100);
    });

    it('EQUAL split of 1 cent across 2 members yields [1, 0] (zero splits are legitimate)', () => {
        const splits = calculateSplitAmounts(1, null, [{ id: 'u1' }, { id: 'u2' }]);
        expect(splits.map((s) => s.amount)).toEqual([1, 0]);
    });
});
