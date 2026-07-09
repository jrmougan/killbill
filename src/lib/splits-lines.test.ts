import { describe, it, expect } from 'vitest';
import {
    calculateSplitAmounts,
    calculateSplitAmountsFromLines,
    hasExclusiveReceiptItems,
    hasExclusiveReceiptLines,
} from './splits';
import { toCents } from './currency';

/**
 * Phase 4 read-switch ("receipt-full") parity: the cents-native twins over
 * persisted ReceiptLineItem rows must return BYTE-IDENTICAL results to the euro
 * functions over the equivalent receiptData JSON. This is the unit-level mirror
 * of audit gates G2/G2b and is what keeps reconcile-ledger green (split cents
 * unchanged). Lines are derived exactly as buildReceiptLineItems does:
 * lineTotal = toCents(item.total), assignedToId = item.assignedTo.
 */
const members = [{ id: 'user1' }, { id: 'user2' }];

type EuroItem = { total: number; assignedTo?: string | null };
const linesOf = (items: EuroItem[]) =>
    items.map((it) => ({ lineTotal: toCents(it.total), assignedToId: it.assignedTo ?? null }));

const FIXTURES: { name: string; amountCents: number; items: EuroItem[]; expected: number[] }[] = [
    { name: 'no exclusive (50/50)', amountCents: 2000, items: [{ total: 10 }, { total: 10 }], expected: [1000, 1000] },
    { name: 'single exclusive to user2', amountCents: 2492, items: [{ total: 17.74, assignedTo: null }, { total: 7.18, assignedTo: 'user2' }], expected: [887, 1605] },
    { name: 'all exclusive to user2', amountCents: 1500, items: [{ total: 10, assignedTo: 'user2' }, { total: 5, assignedTo: 'user2' }], expected: [0, 1500] },
    { name: 'both users exclusive', amountCents: 1800, items: [{ total: 10, assignedTo: null }, { total: 3, assignedTo: 'user1' }, { total: 5, assignedTo: 'user2' }], expected: [800, 1000] },
    { name: 'rounding discrepancy', amountCents: 1000, items: [{ total: 7.01, assignedTo: null }, { total: 3, assignedTo: 'user2' }], expected: [] },
];

describe('calculateSplitAmountsFromLines — parity with the euro path', () => {
    for (const f of FIXTURES) {
        it(`matches calculateSplitAmounts for: ${f.name}`, () => {
            const euro = calculateSplitAmounts(f.amountCents, f.items, members);
            const cents = calculateSplitAmountsFromLines(f.amountCents, linesOf(f.items), members);
            expect(cents).toEqual(euro);
            // both always sum to the amount
            expect(cents.reduce((s, x) => s + x.amount, 0)).toBe(f.amountCents);
            if (f.expected.length) {
                expect(cents.map((s) => s.amount)).toEqual(f.expected);
            }
        });
    }

    it('null lines take the EQUAL branch, matching null receiptData', () => {
        expect(calculateSplitAmountsFromLines(2001, null, members))
            .toEqual(calculateSplitAmounts(2001, null, members));
        expect(calculateSplitAmountsFromLines(2001, null, members).map((s) => s.amount)).toEqual([1001, 1000]);
    });

    it('<2 members yields the degenerate EQUAL branch even with exclusive lines', () => {
        const solo = [{ id: 'user1' }];
        expect(calculateSplitAmountsFromLines(1500, linesOf([{ total: 15, assignedTo: 'user1' }]), solo))
            .toEqual([{ userId: 'user1', amount: 1500 }]);
    });

    it('negative lineTotal (promotion line) stays consistent between paths', () => {
        const items = [{ total: 20, assignedTo: null }, { total: -5, assignedTo: 'user2' }];
        const amountCents = 1500;
        expect(calculateSplitAmountsFromLines(amountCents, linesOf(items), members))
            .toEqual(calculateSplitAmounts(amountCents, items, members));
    });
});

describe('hasExclusiveReceiptLines — parity with hasExclusiveReceiptItems', () => {
    for (const f of FIXTURES) {
        it(`matches for: ${f.name}`, () => {
            expect(hasExclusiveReceiptLines(linesOf(f.items)))
                .toBe(hasExclusiveReceiptItems(f.items));
        });
    }

    it('false for null/undefined/empty', () => {
        expect(hasExclusiveReceiptLines(null)).toBe(false);
        expect(hasExclusiveReceiptLines(undefined)).toBe(false);
        expect(hasExclusiveReceiptLines([])).toBe(false);
    });
});
