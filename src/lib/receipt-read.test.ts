import { describe, it, expect } from 'vitest';
import { receiptItemsView, linesForSplit, type ReceiptLineRow } from './receipt-read';
import { toEuros } from './currency';

/**
 * Phase 4 read-switch ("receipt-full"): pins the cents->euros display conversion
 * and assignedTo semantics of receiptItemsView + linesForSplit. Display sums must
 * stay byte-identical to the legacy receiptData JSON read (toEuros(toCents(x))==x
 * for 2-decimal euro values).
 */
const row = (over: Partial<ReceiptLineRow> = {}): ReceiptLineRow => ({
    description: 'Item',
    quantity: 1,
    unitPrice: 1774,
    lineTotal: 1774,
    position: 0,
    assignedToId: null,
    ...over,
});

describe('receiptItemsView', () => {
    it('maps a cents row to the euro DTO the UI expects', () => {
        const [item] = receiptItemsView([row({ description: 'Leche', quantity: 2, unitPrice: 1774, lineTotal: 1774 })]);
        expect(item).toEqual({
            description: 'Leche',
            quantity: 2,
            price: 17.74,
            total: 17.74,
            assignedTo: null,
        });
        expect(item.price).toBe(toEuros(1774));
        expect(item.total).toBe(toEuros(1774));
    });

    it('per-item euro totals are byte-identical to the legacy receiptData floats', () => {
        // Each row maps to toEuros(lineTotal); since the legacy receiptData stored
        // exactly those euro floats (lineTotal == toCents(total)), the display sum
        // is identical to the legacy sum — the UI sums per-item euros (accumulating
        // the same float, NOT toEuros(Σcents), which would differ by FP epsilon).
        const rows = [row({ lineTotal: 1774 }), row({ lineTotal: 718, position: 1 }), row({ lineTotal: 500, position: 2 })];
        const items = receiptItemsView(rows);
        expect(items.map((i) => i.total)).toEqual([17.74, 7.18, 5.0]);
        const displaySum = items.reduce((s, i) => s + i.total, 0);
        const legacySum = rows.reduce((s, r) => s + toEuros(r.lineTotal), 0);
        expect(displaySum).toBe(legacySum);
    });

    it('preserves assignedToId 1:1 as assignedTo (exclusive vs shared)', () => {
        const items = receiptItemsView([row({ assignedToId: 'user2' }), row({ assignedToId: null, position: 1 })]);
        expect(items[0].assignedTo).toBe('user2');
        expect(items[1].assignedTo).toBeNull();
    });

    it('returns rows in position order even when input is shuffled (defensive sort)', () => {
        const items = receiptItemsView([
            row({ description: 'C', position: 2 }),
            row({ description: 'A', position: 0 }),
            row({ description: 'B', position: 1 }),
        ]);
        expect(items.map((i) => i.description)).toEqual(['A', 'B', 'C']);
    });

    it('negative lineTotal (promotion) maps to a negative euro total', () => {
        const [item] = receiptItemsView([row({ lineTotal: -500, unitPrice: -500 })]);
        expect(item.total).toBe(toEuros(-500));
        expect(item.total).toBeLessThan(0);
    });

    it('null/undefined lines yield []', () => {
        expect(receiptItemsView(null)).toEqual([]);
        expect(receiptItemsView(undefined)).toEqual([]);
    });
});

describe('linesForSplit', () => {
    it('strips rows to { lineTotal, assignedToId } only', () => {
        expect(linesForSplit([row({ lineTotal: 718, assignedToId: 'user2' })]))
            .toEqual([{ lineTotal: 718, assignedToId: 'user2' }]);
    });

    it('null lines stay null (EQUAL-branch parity)', () => {
        expect(linesForSplit(null)).toBeNull();
        expect(linesForSplit(undefined)).toBeNull();
    });
});
