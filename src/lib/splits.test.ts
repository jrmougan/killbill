import { describe, it, expect } from 'vitest';
import { calculateSplitAmounts } from './splits';

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
});
