import { describe, expect, it } from 'vitest';
import { calculateBalances, resolveMyDebts } from './finance';
import { computeExpenseEntries } from './ledger';
import { calculateSplitAmounts, calculateSplitAmountsFromLines, rescaleSplits } from './splits';

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);

describe('financial conservation across group sizes', () => {
    it('conserves every cent and keeps equal shares within one cent for 2–20 members', () => {
        for (let count = 2; count <= 20; count++) {
            const members = Array.from({ length: count }, (_, index) => ({ id: `u${index}` }));
            // Include totals smaller than the group and all possible remainders.
            for (const amount of [0, ...Array.from({ length: count * 2 }, (_, index) => index + 1), 10001, 999999]) {
                const splits = calculateSplitAmounts(amount, null, members);
                const shares = splits.map(split => split.amount);
                expect(sum(shares)).toBe(amount);
                expect(shares.every(share => Number.isInteger(share) && share >= 0)).toBe(true);
                expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
                expect(new Set(splits.map(split => split.userId)).size).toBe(count);

                const expense = { amount, paidById: members[count - 1].id, splits };
                const explicit = calculateBalances(members, [expense], [], members[0].id);
                const implicit = calculateBalances(members, [{ ...expense, splits: [] }], [], members[0].id);
                expect(explicit).toEqual(implicit);
                expect(sum(Object.values(explicit))).toBe(0);
                expect(sum(computeExpenseEntries(expense, members).map(entry => entry.amount))).toBe(0);
            }
        }
    });

    it('charges exclusive receipt items only to their assignee in a four-member group', () => {
        const members = ['a', 'b', 'c', 'd'].map(id => ({ id }));
        const lines = [
            { lineTotal: 1003 },
            { lineTotal: 725, assignedToId: 'b' },
            { lineTotal: 399, assignedToId: 'd' },
        ];
        const expected = [251, 976, 251, 649];
        const cents = calculateSplitAmountsFromLines(2127, lines, members);
        const euros = calculateSplitAmounts(2127, lines.map(line => ({
            total: line.lineTotal / 100, assignedTo: line.assignedToId,
        })), members);
        expect(cents.map(split => split.amount)).toEqual(expected);
        expect(euros).toEqual(cents);
        expect(sum(expected)).toBe(2127);
        expect(calculateBalances(members, [{ paidById: 'c', amount: 2127, splits: cents }], [], 'a'))
            .toEqual({ a: -251, b: -976, c: 1876, d: -649 });
    });

    it('conserves successive custom amount edits without mutating prior shares', () => {
        let splits = [
            { userId: 'a', amount: 137 }, { userId: 'b', amount: 251 },
            { userId: 'c', amount: 613 }, { userId: 'd', amount: 999 },
        ];
        for (const total of [2001, 7, 10003, 0, 19, 8000]) {
            const snapshot = structuredClone(splits);
            const edited = rescaleSplits(splits, total);
            expect(splits).toEqual(snapshot);
            expect(edited.map(split => split.userId)).toEqual(['a', 'b', 'c', 'd']);
            expect(edited.every(split => Number.isInteger(split.amount) && split.amount >= 0)).toBe(true);
            expect(sum(edited.map(split => split.amount))).toBe(total);
            expect(rescaleSplits(edited, total)).toEqual(edited);
            splits = edited;
        }
    });

    it('partial payments reduce only the participants’ positions and can fully settle a group', () => {
        const members = ['a', 'b', 'c', 'd'].map(id => ({ id }));
        const expenses = [{ paidById: 'a', amount: 10003 }];
        const payments = [
            { fromUserId: 'b', toUserId: 'a', amount: 1000 },
            { fromUserId: 'b', toUserId: 'a', amount: 1501 },
            { fromUserId: 'c', toUserId: 'a', amount: 2501 },
            { fromUserId: 'd', toUserId: 'a', amount: 2500 },
        ];
        const states = [
            { a: 7502, b: -2501, c: -2501, d: -2500 },
            { a: 6502, b: -1501, c: -2501, d: -2500 },
            { a: 5001, b: 0, c: -2501, d: -2500 },
            { a: 2500, b: 0, c: 0, d: -2500 },
            { a: 0, b: 0, c: 0, d: 0 },
        ];
        for (let count = 0; count <= payments.length; count++) {
            const balances = calculateBalances(members, expenses, payments.slice(0, count), 'b');
            expect(balances).toEqual(states[count]);
            expect(sum(Object.values(balances))).toBe(0);
            const snapshot = { ...balances };
            for (const { id } of members) {
                const debts = resolveMyDebts(balances, id);
                expect(sum(Object.values(debts))).toBe(Math.max(0, -balances[id]));
                expect(resolveMyDebts(balances, id)).toEqual(debts);
            }
            expect(balances).toEqual(snapshot);
        }
        expect(calculateBalances(members, [...expenses].reverse(), [...payments].reverse(), 'a'))
            .toEqual(states[4]);
    });
});
