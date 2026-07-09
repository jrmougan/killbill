import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSeriesFindMany = vi.fn();
const mockExpenseFindFirst = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        recurringSeries: { findMany: (...a: unknown[]) => mockSeriesFindMany(...a) },
        expense: { findFirst: (...a: unknown[]) => mockExpenseFindFirst(...a) },
        $transaction: (...a: unknown[]) => mockTransaction(...a),
    },
}));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: vi.fn() }));
vi.mock('@/lib/membership', () => ({
    getGroupMembers: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
}));

import { materializeDueRecurringExpenses, materializeDueRecurringExpensesForOwner } from './recurring';
import { postExpenseLedger } from '@/lib/ledger';

describe('recurring materialization (series-driven)', () => {
    beforeEach(() => {
        mockSeriesFindMany.mockReset();
        mockExpenseFindFirst.mockReset();
        mockTransaction.mockReset();
        vi.mocked(postExpenseLedger).mockClear();
        mockSeriesFindMany.mockResolvedValue([]);
    });

    it('owner scope queries PERSONAL, ACTIVE series by ownerId (not coupleId)', async () => {
        expect(await materializeDueRecurringExpensesForOwner('u1')).toBe(0);
        const where = mockSeriesFindMany.mock.calls[0][0].where;
        expect(where.ownerId).toBe('u1');
        expect(where.visibility).toBe('PERSONAL');
        expect(where.isActive).toBe(true);
        expect(where.coupleId).toBeUndefined();
    });

    it('couple scope queries SHARED, ACTIVE series by coupleId (not ownerId)', async () => {
        expect(await materializeDueRecurringExpenses('c1')).toBe(0);
        const where = mockSeriesFindMany.mock.calls[0][0].where;
        expect(where.coupleId).toBe('c1');
        expect(where.visibility).toBe('SHARED');
        expect(where.isActive).toBe(true);
        expect(where.ownerId).toBeUndefined();
    });

    it('a due series with no live template is skipped (no create, no claim)', async () => {
        const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 999 },
        ]);
        mockExpenseFindFirst.mockResolvedValue(null); // template deleted / never linked
        expect(await materializeDueRecurringExpenses('c1')).toBe(0);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('materializes from TEMPLATE scalars even when the series amount is stale, and advances template.nextRecurringDate in lockstep', async () => {
        const past = new Date(Date.now() - 60 * 1000);
        // series.amount deliberately STALE (5000) vs template.amount (6000):
        // the instance must use the template, whose splits sum to 6000 — this
        // pins the edit-staleness fix (review bug 1: non-zero-sum ledger post).
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 5000 },
        ]);
        mockExpenseFindFirst.mockResolvedValue({
            id: 'tpl1', description: 'Rent', amount: 6000, category: 'rent',
            categoryId: null, paidById: 'u1', ownerId: 'u1', visibility: 'SHARED',
            splitStrategy: 'EQUAL', coupleId: 'c1', notes: null,
            splits: [{ userId: 'u1', amount: 3000 }, { userId: 'u2', amount: 3000 }],
            tags: [],
        });
        const txExpenseCreate = vi.fn().mockImplementation(async ({ data }) => ({
            ...data, id: 'inst1',
            splits: [{ userId: 'u1', amount: 3000 }, { userId: 'u2', amount: 3000 }],
        }));
        const txExpenseUpdate = vi.fn();
        const tx = {
            recurringSeries: { updateMany: vi.fn()
                .mockResolvedValueOnce({ count: 1 })   // first occurrence claimed
                .mockResolvedValue({ count: 0 }) },    // then lose the race → stop
            expense: { create: txExpenseCreate, update: txExpenseUpdate },
        };
        mockTransaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

        expect(await materializeDueRecurringExpenses('c1')).toBe(1);

        const createdData = txExpenseCreate.mock.calls[0][0].data;
        expect(createdData.amount).toBe(6000);        // template, NOT stale series 5000
        expect(createdData.seriesId).toBe('s1');
        expect(createdData.isRecurring).toBe(false);
        expect(createdData.date).toEqual(past);       // scheduled occurrence date
        // lockstep dual-write on the template's legacy field
        expect(txExpenseUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'tpl1' },
            data: { nextRecurringDate: expect.any(Date) },
        }));
        // ledger posted with the balanced template splits
        expect(vi.mocked(postExpenseLedger).mock.calls[0][1]).toMatchObject({
            expenseId: 'inst1', groupId: 'c1', amount: 6000,
        });
    });
});
