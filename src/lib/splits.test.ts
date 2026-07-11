import { describe, it, expect } from 'vitest';
import { calculateSplitAmounts, hasExclusiveReceiptItems, rescaleSplits } from './splits';

describe('rescaleSplits (N-way proportional rescale for edited CUSTOM expenses)', () => {
    it('rescales proportionally and always sums to the new total (3 members)', () => {
        // 1000/2000/3000 (Σ6000) rescaled to 12000 → doubles each share.
        const out = rescaleSplits(
            [{ userId: 'a', amount: 1000 }, { userId: 'b', amount: 2000 }, { userId: 'c', amount: 3000 }],
            12000,
        );
        expect(out).toEqual([
            { userId: 'a', amount: 2000 },
            { userId: 'b', amount: 4000 },
            { userId: 'c', amount: 6000 },
        ]);
        expect(out.reduce((s, x) => s + x.amount, 0)).toBe(12000);
    });

    it('assigns the rounding remainder to the first member so Σ is exact', () => {
        // 1000/1000/1000 (Σ3000) rescaled to 1000 → floor gives 333/333/333=999,
        // the 1-cent remainder lands on the first member.
        const out = rescaleSplits(
            [{ userId: 'a', amount: 1000 }, { userId: 'b', amount: 1000 }, { userId: 'c', amount: 1000 }],
            1000,
        );
        expect(out).toEqual([
            { userId: 'a', amount: 334 },
            { userId: 'b', amount: 333 },
            { userId: 'c', amount: 333 },
        ]);
        expect(out.reduce((s, x) => s + x.amount, 0)).toBe(1000);
    });

    it('never collapses a 4-member split (keeps all members)', () => {
        const out = rescaleSplits(
            [{ userId: 'a', amount: 500 }, { userId: 'b', amount: 500 }, { userId: 'c', amount: 500 }, { userId: 'd', amount: 500 }],
            8000,
        );
        expect(out).toHaveLength(4);
        expect(out.reduce((s, x) => s + x.amount, 0)).toBe(8000);
    });

    it('falls back to an even N-way division when the old total is zero', () => {
        const out = rescaleSplits(
            [{ userId: 'a', amount: 0 }, { userId: 'b', amount: 0 }, { userId: 'c', amount: 0 }],
            1000,
        );
        expect(out).toEqual([
            { userId: 'a', amount: 334 },
            { userId: 'b', amount: 333 },
            { userId: 'c', amount: 333 },
        ]);
    });

    it('returns [] for an empty split set', () => {
        expect(rescaleSplits([], 5000)).toEqual([]);
    });
});

describe('hasExclusiveReceiptItems', () => {
    it('returns false for null/undefined/empty', () => {
        expect(hasExclusiveReceiptItems(null)).toBe(false);
        expect(hasExclusiveReceiptItems(undefined)).toBe(false);
        expect(hasExclusiveReceiptItems([])).toBe(false);
    });

    it('returns false when no item is assigned', () => {
        expect(hasExclusiveReceiptItems([
            { total: 10, assignedTo: null },
            { total: 5 },
        ])).toBe(false);
    });

    it('returns true when any item is assigned to a member (bare array)', () => {
        expect(hasExclusiveReceiptItems([
            { total: 10, assignedTo: null },
            { total: 5, assignedTo: 'user2' },
        ])).toBe(true);
    });

    it('tolerates an object wrapping an items array', () => {
        expect(hasExclusiveReceiptItems({ items: [{ total: 5, assignedTo: 'user1' }] })).toBe(true);
        expect(hasExclusiveReceiptItems({ items: [{ total: 5 }] })).toBe(false);
    });

    it('returns false for malformed JSON shapes', () => {
        expect(hasExclusiveReceiptItems({ foo: 'bar' })).toBe(false);
        expect(hasExclusiveReceiptItems('not an object')).toBe(false);
        expect(hasExclusiveReceiptItems(42)).toBe(false);
    });
});

describe('calculateSplitAmounts', () => {
    const members = [
        { id: 'user1' },
        { id: 'user2' },
    ];

    it('should split 50/50 when no receiptData', () => {
        const splits = calculateSplitAmounts(2000, null, members);
        expect(splits).toEqual([
            { userId: 'user1', amount: 1000 },
            { userId: 'user2', amount: 1000 },
        ]);
    });

    it('should split 50/50 when receiptData has no exclusive items', () => {
        const receiptData = [
            { total: 10.00, assignedTo: null },
            { total: 10.00, assignedTo: null },
        ];
        const splits = calculateSplitAmounts(2000, receiptData, members);
        expect(splits).toEqual([
            { userId: 'user1', amount: 1000 },
            { userId: 'user2', amount: 1000 },
        ]);
    });

    it('should account for exclusive items assigned to partner', () => {
        // 17.74€ common + 7.18€ exclusive to user2 = 24.92€ total
        const receiptData = [
            { total: 17.74, assignedTo: null },
            { total: 7.18, assignedTo: 'user2' },
        ];
        const amountCents = 2492;
        const splits = calculateSplitAmounts(amountCents, receiptData, members);

        // Common: 1774 cents → 887 each
        // Exclusive user2: 718 cents
        // user1: 887, user2: 887 + 718 = 1605
        expect(splits).toEqual([
            { userId: 'user1', amount: 887 },
            { userId: 'user2', amount: 1605 },
        ]);
    });

    it('should handle all items exclusive to one user', () => {
        const receiptData = [
            { total: 10.00, assignedTo: 'user2' },
            { total: 5.00, assignedTo: 'user2' },
        ];
        const splits = calculateSplitAmounts(1500, receiptData, members);
        // Common: 0 → 0 each. Exclusive user2: 1500
        expect(splits).toEqual([
            { userId: 'user1', amount: 0 },
            { userId: 'user2', amount: 1500 },
        ]);
    });

    it('should handle odd cents with remainder going to first member', () => {
        const splits = calculateSplitAmounts(1001, null, members);
        expect(splits).toEqual([
            { userId: 'user1', amount: 501 },
            { userId: 'user2', amount: 500 },
        ]);
    });

    it('should handle exclusive items for both users', () => {
        const receiptData = [
            { total: 10.00, assignedTo: null },   // common
            { total: 3.00, assignedTo: 'user1' },  // exclusive user1
            { total: 5.00, assignedTo: 'user2' },  // exclusive user2
        ];
        const amountCents = 1800;
        const splits = calculateSplitAmounts(amountCents, receiptData, members);

        // Common: 1000 → 500 each
        // user1: 500 + 300 = 800
        // user2: 500 + 500 = 1000
        expect(splits).toEqual([
            { userId: 'user1', amount: 800 },
            { userId: 'user2', amount: 1000 },
        ]);
    });

    it('should adjust for rounding discrepancy between receipt totals and amount', () => {
        // Receipt items sum to 10.01€ but amount is 10.00€
        const receiptData = [
            { total: 7.01, assignedTo: null },
            { total: 3.00, assignedTo: 'user2' },
        ];
        const amountCents = 1000;
        const splits = calculateSplitAmounts(amountCents, receiptData, members);

        // sum of splits should equal amountCents regardless of receipt rounding
        const total = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(total).toBe(1000);
    });

    it('should split N-way (3 members) with the remainder going to the first member(s)', () => {
        const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const splits = calculateSplitAmounts(100, null, members);
        // 100 / 3 = 33 each, 1 leftover cent to the first member
        expect(splits).toEqual([
            { userId: 'a', amount: 34 },
            { userId: 'b', amount: 33 },
            { userId: 'c', amount: 33 },
        ]);
        expect(splits.reduce((acc, s) => acc + s.amount, 0)).toBe(100);
    });

    it('should split N-way (3 members) evenly when divisible', () => {
        const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const splits = calculateSplitAmounts(99, null, members);
        expect(splits.map((s) => s.amount)).toEqual([33, 33, 33]);
    });
});
