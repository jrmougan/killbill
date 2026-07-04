import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExpenseFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        expense: { findMany: (...a: unknown[]) => mockExpenseFindMany(...a) },
    },
}));

import { materializeDueRecurringExpenses, materializeDueRecurringExpensesForOwner } from './recurring';

describe('recurring materialization scoping', () => {
    beforeEach(() => {
        mockExpenseFindMany.mockReset();
        mockExpenseFindMany.mockResolvedValue([]); // nothing due → no $transaction needed
    });

    it('owner scope queries PERSONAL expenses by ownerId (not coupleId)', async () => {
        const created = await materializeDueRecurringExpensesForOwner('u1');
        expect(created).toBe(0);
        const where = mockExpenseFindMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('u1');
        expect(where.visibility).toBe('PERSONAL');
        expect(where.isRecurring).toBe(true);
        expect(where.coupleId).toBeUndefined();
    });

    it('couple scope queries SHARED expenses by coupleId (not ownerId)', async () => {
        const created = await materializeDueRecurringExpenses('c1');
        expect(created).toBe(0);
        const where = mockExpenseFindMany.mock.calls[0][0].where;
        expect(where.coupleId).toBe('c1');
        expect(where.visibility).toBe('SHARED');
        expect(where.ownerId).toBeUndefined();
    });
});
