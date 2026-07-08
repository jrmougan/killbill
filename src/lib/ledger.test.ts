import { describe, it, expect } from 'vitest';
import { computeExpenseEntries } from './ledger';
import { calculateBalances } from './finance';

const members = [{ id: 'u1' }, { id: 'u2' }];
const sum = (es: { amount: number }[]) => es.reduce((a, e) => a + e.amount, 0);

describe('computeExpenseEntries', () => {
    it('is zero-sum for an equal (no-splits) expense with an odd amount', () => {
        // 2067 split 2 ways → shares 1034/1033 (remainder cent to first member).
        const entries = computeExpenseEntries({ amount: 2067, paidById: 'u1', splits: [] }, members);
        expect(sum(entries)).toBe(0);
        // Payer u1: paid 2067 − share 1034 = +1033; u2: −1033.
        const byUser = Object.fromEntries(entries.map((e) => [e.userId, e.amount]));
        expect(byUser.u1).toBe(1033);
        expect(byUser.u2).toBe(-1033);
    });

    it('is zero-sum with explicit splits and drops zero deltas', () => {
        // u1 pays 1000, split 400/600. u1: 1000−400=+600; u2: −600.
        const entries = computeExpenseEntries(
            { amount: 1000, paidById: 'u1', splits: [{ userId: 'u1', amount: 400 }, { userId: 'u2', amount: 600 }] },
            members,
        );
        expect(sum(entries)).toBe(0);
        const byUser = Object.fromEntries(entries.map((e) => [e.userId, e.amount]));
        expect(byUser.u1).toBe(600);
        expect(byUser.u2).toBe(-600);
    });

    it('keeps a departed payer/split-holder so the transaction stays zero-sum', () => {
        // Payer u3 has left the group (not in members) but must still get an entry.
        const entries = computeExpenseEntries(
            { amount: 1000, paidById: 'u3', splits: [{ userId: 'u1', amount: 500 }, { userId: 'u2', amount: 500 }] },
            members,
        );
        expect(sum(entries)).toBe(0);
        const byUser = Object.fromEntries(entries.map((e) => [e.userId, e.amount]));
        expect(byUser.u3).toBe(1000);
        expect(byUser.u1).toBe(-500);
        expect(byUser.u2).toBe(-500);
    });

    it('reconciles with calculateBalances (expenses only) for a mixed set', () => {
        const raw = [
            { paidById: 'u1', amount: 2067, splits: [{ userId: 'u1', amount: 1034 }, { userId: 'u2', amount: 1033 }] },
            { paidById: 'u2', amount: 500, splits: [{ userId: 'u1', amount: 250 }, { userId: 'u2', amount: 250 }] },
        ];
        const expected = calculateBalances(members, raw, [], 'u1');

        const ledger: Record<string, number> = { u1: 0, u2: 0 };
        for (const e of raw) {
            for (const entry of computeExpenseEntries(e, members)) {
                ledger[entry.userId] = (ledger[entry.userId] ?? 0) + entry.amount;
            }
        }
        expect(ledger).toEqual(expected);
    });
});
