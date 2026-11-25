import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSeriesFindMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        recurringSeries: { findMany: (...a: unknown[]) => mockSeriesFindMany(...a) },
        $transaction: (...a: unknown[]) => mockTransaction(...a),
    },
}));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: vi.fn() }));

import {
    materializeAllDueRecurring,
    materializeDueRecurringExpenses,
    materializeDueRecurringExpensesForOwner,
} from './recurring';
import { postExpenseLedger } from '@/lib/ledger';

const TEMPLATE = {
    id: 'tpl1', description: 'Rent', amount: 6000,
    categoryId: null, paidById: 'u1', ownerId: 'u1', visibility: 'SHARED',
    splitStrategy: 'EQUAL', coupleId: 'c1', notes: null,
    splits: [{ userId: 'u1', amount: 3000 }, { userId: 'u2', amount: 3000 }],
    tags: [],
};

/**
 * Transaction double with the bits the materializer uses. `nextRunDate` is the
 * single shared schedule row, so concurrent runners race on the conditional
 * claim exactly like on the DB; `spaceStatus` is what the space lock returns.
 */
function fakeDb(opts: { nextRunDate: Date; spaceStatus?: string }) {
    const state = { nextRunDate: opts.nextRunDate, created: [] as Record<string, unknown>[] };
    const tx = {
        $queryRaw: vi.fn(async () => [{ status: opts.spaceStatus ?? 'ACTIVE' }]),
        recurringSeries: {
            updateMany: vi.fn(async ({ where, data }: { where: { nextRunDate: Date }; data: { nextRunDate: Date } }) => {
                if (where.nextRunDate.getTime() !== state.nextRunDate.getTime()) return { count: 0 };
                state.nextRunDate = data.nextRunDate;
                return { count: 1 };
            }),
        },
        expense: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                state.created.push(data);
                return { ...data, id: `inst${state.created.length}`, splits: TEMPLATE.splits };
            }),
        },
        membership: { findMany: vi.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }]) },
    };
    mockTransaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    return { state, tx };
}

describe('recurring materialization (series-driven, templateId pointer)', () => {
    beforeEach(() => {
        mockSeriesFindMany.mockReset();
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

    it('the cron entry point covers every scope', async () => {
        expect(await materializeAllDueRecurring()).toBe(0);
        const where = mockSeriesFindMany.mock.calls[0][0].where;
        expect(where.coupleId).toBeUndefined();
        expect(where.ownerId).toBeUndefined();
        expect(where.visibility).toBeUndefined();
    });

    it('M4: templates are loaded in the SAME query as the due series (no per-series lookup)', async () => {
        await materializeDueRecurringExpenses('c1');
        expect(mockSeriesFindMany).toHaveBeenCalledOnce();
        const args = mockSeriesFindMany.mock.calls[0][0];
        expect(args.include).toEqual({ template: { include: { splits: true, tags: true } } });
        expect(args.where.templateId).toEqual({ not: null });
    });

    it('a series whose template was deleted (FK SetNull) is skipped', async () => {
        const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 999, templateId: 'tpl-gone', template: null },
        ]);
        expect(await materializeDueRecurringExpenses('c1')).toBe(0);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('materializes from TEMPLATE scalars even when series amount is stale, inside a READ COMMITTED ledger tx', async () => {
        const past = new Date(Date.now() - 60 * 1000);
        // series.amount deliberately STALE (5000) vs template.amount (6000).
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 5000, templateId: 'tpl1', template: TEMPLATE },
        ]);
        const { state, tx } = fakeDb({ nextRunDate: past });

        expect(await materializeDueRecurringExpenses('c1')).toBe(1);

        const createdData = state.created[0];
        expect(createdData.amount).toBe(6000);        // template, NOT stale series 5000
        expect(createdData.seriesId).toBe('s1');
        expect(createdData.date).toEqual(past);       // scheduled occurrence date
        expect('isRecurring' in createdData).toBe(false);
        // runLedgerTransaction: READ COMMITTED (+ retry), not the default isolation.
        expect(mockTransaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'ReadCommitted' });
        // Space lock taken, roster read INSIDE the tx, ledger posted balanced.
        expect(tx.$queryRaw).toHaveBeenCalled();
        expect(tx.membership.findMany).toHaveBeenCalled();
        expect(vi.mocked(postExpenseLedger).mock.calls[0][1]).toMatchObject({
            expenseId: 'inst1', groupId: 'c1', amount: 6000, members: [{ id: 'u1' }, { id: 'u2' }],
        });
    });

    it('idempotent: two concurrent runners (dashboard + cron) create each occurrence exactly once', async () => {
        // Two missed months → 2 occurrences to catch up.
        const now = new Date();
        const twoMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1, 12));
        const series = { id: 's1', interval: 'monthly', nextRunDate: twoMonthsAgo, amount: 6000, templateId: 'tpl1', template: TEMPLATE };
        mockSeriesFindMany.mockResolvedValue([series]);
        const { state } = fakeDb({ nextRunDate: twoMonthsAgo });

        const [a, b] = await Promise.all([materializeDueRecurringExpenses('c1'), materializeAllDueRecurring()]);
        const dates = state.created.map((d) => (d.date as Date).toISOString());
        expect(a + b).toBe(state.created.length);
        expect(new Set(dates).size).toBe(dates.length); // no occurrence twice

        // A later run finds nothing left to do.
        mockSeriesFindMany.mockResolvedValue([{ ...series, nextRunDate: state.nextRunDate }]);
        const before = state.created.length;
        expect(await materializeAllDueRecurring()).toBe(0);
        expect(state.created.length).toBe(before);
    });

    it.each(['SETTLING', 'ARCHIVED'])('a %s space gets no new expense and its series is not advanced', async (status) => {
        const past = new Date(Date.now() - 60 * 1000);
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 6000, templateId: 'tpl1', template: TEMPLATE },
        ]);
        const { state, tx } = fakeDb({ nextRunDate: past, spaceStatus: status });
        expect(await materializeDueRecurringExpenses('c1')).toBe(0);
        expect(tx.recurringSeries.updateMany).not.toHaveBeenCalled();
        expect(state.created).toHaveLength(0);
        expect(state.nextRunDate).toEqual(past);
    });

    it('a PERSONAL series takes no space lock', async () => {
        const past = new Date(Date.now() - 60 * 1000);
        const personal = { ...TEMPLATE, visibility: 'PERSONAL', coupleId: null, splits: [] };
        mockSeriesFindMany.mockResolvedValue([
            { id: 's1', interval: 'monthly', nextRunDate: past, amount: 6000, templateId: 'tpl1', template: personal },
        ]);
        const { tx } = fakeDb({ nextRunDate: past });
        expect(await materializeDueRecurringExpensesForOwner('u1')).toBe(1);
        expect(tx.$queryRaw).not.toHaveBeenCalled();
        expect(postExpenseLedger).not.toHaveBeenCalled();
    });
});
