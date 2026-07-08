import { describe, it, expect } from 'vitest';
import { buildReceiptLineItems } from './receipt';

describe('buildReceiptLineItems', () => {
    const members = new Set(['user1', 'user2']);

    it('returns [] for non-array input', () => {
        expect(buildReceiptLineItems(null, members)).toEqual([]);
        expect(buildReceiptLineItems(undefined, members)).toEqual([]);
        expect(buildReceiptLineItems({ items: [] }, members)).toEqual([]);
    });

    it('converts euro floats to integer cents and keeps order', () => {
        const rows = buildReceiptLineItems(
            [
                { description: 'A', quantity: 1, price: 4.19, total: 4.19, assignedTo: null },
                { description: 'B', quantity: 2, price: 1.5, total: 3.0, assignedTo: null },
            ],
            members,
        );
        expect(rows).toEqual([
            { description: 'A', quantity: 1, unitPrice: 419, lineTotal: 419, position: 0, assignedToId: null },
            { description: 'B', quantity: 2, unitPrice: 150, lineTotal: 300, position: 1, assignedToId: null },
        ]);
    });

    it('preserves negative line totals (promotions)', () => {
        const [row] = buildReceiptLineItems([{ description: 'Promo', total: -2.1 }], members);
        expect(row.lineTotal).toBe(-210);
        expect(row.unitPrice).toBe(-210); // falls back to total when price missing
    });

    it('keeps a valid assignee but drops an unknown one to null', () => {
        const rows = buildReceiptLineItems(
            [
                { description: 'mine', total: 10, assignedTo: 'user2' },
                { description: 'ghost', total: 10, assignedTo: 'nobody' },
            ],
            members,
        );
        expect(rows[0].assignedToId).toBe('user2');
        expect(rows[1].assignedToId).toBeNull();
    });

    it('defaults quantity to 1 and description to empty string', () => {
        const [row] = buildReceiptLineItems([{ price: 5, total: 5 }], members);
        expect(row.quantity).toBe(1);
        expect(row.description).toBe('');
    });
});
