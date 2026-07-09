import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockGetPrimaryGroup = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockTxExpenseUpdate = vi.fn();
const mockTxSplitDeleteMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Members come from the Membership layer; ledger posting is covered by
// reconcile-ledger.ts + ledger tests — both stubbed so this test stays focused
// on the personal->shared promotion + split generation.
vi.mock('@/lib/membership', () => ({
    getGroupMembers: async () => [{ id: 'u1' }, { id: 'u2' }],
    getPrimaryGroup: (...a: unknown[]) => mockGetPrimaryGroup(...a),
}));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: vi.fn() }));
vi.mock('@/lib/db', () => ({
    prisma: {
        user: {
            findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
            findMany: (...a: unknown[]) => mockUserFindMany(...a),
        },
        expense: { findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a) },
        $transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
    },
}));

import { POST } from './route';

const params = Promise.resolve({ id: 'e1' });
function req() {
    return new Request('http://localhost/api/expenses/e1/share', { method: 'POST' });
}
function personal(overrides = {}) {
    return { id: 'e1', visibility: 'PERSONAL', ownerId: 'u1', amount: 5000, receiptData: null, isRecurring: false, recurringInterval: null, ...overrides };
}

describe('POST /api/expenses/[id]/share', () => {
    beforeEach(() => {
        [mockGetSession, mockGetPrimaryGroup, mockUserFindUnique, mockUserFindMany, mockExpenseFindUnique, mockTxExpenseUpdate, mockTxSplitDeleteMany, mockTransaction].forEach((m) => m.mockReset());
        // Run the transaction callback against a tx double.
        mockTransaction.mockImplementation(async (cb) => cb({
            split: { deleteMany: (...a: unknown[]) => mockTxSplitDeleteMany(...a) },
            expense: { update: (...a: unknown[]) => mockTxExpenseUpdate(...a) },
        }));
        mockTxExpenseUpdate.mockResolvedValue({});
        mockTxSplitDeleteMany.mockResolvedValue({});
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(401);
    });

    it('400 when the caller has no couple', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(400);
    });

    it('404 when the expense does not exist', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(404);
    });

    it('403 when the caller is not the owner', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal({ ownerId: 'u1' }));
        expect((await POST(req(), { params })).status).toBe(403);
    });

    it('409 when the expense is already shared', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal({ visibility: 'SHARED' }));
        expect((await POST(req(), { params })).status).toBe(409);
    });

    it('promotes to SHARED with couple + generated splits', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal());
        mockUserFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        const res = await POST(req(), { params });
        expect(res.status).toBe(200);
        expect(mockTxExpenseUpdate).toHaveBeenCalledOnce();
        const arg = mockTxExpenseUpdate.mock.calls[0][0];
        expect(arg.data.visibility).toBe('SHARED');
        expect(arg.data.coupleId).toBe('c1');
        // 5000 split 50/50 between two members
        const created = arg.data.splits.create;
        expect(created).toHaveLength(2);
        expect(created.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBe(5000);
    });

    it('resets nextRecurringDate to the future when the shared source is recurring', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal({ isRecurring: true, recurringInterval: 'monthly' }));
        mockUserFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        await POST(req(), { params });
        const arg = mockTxExpenseUpdate.mock.calls[0][0];
        expect(arg.data.nextRecurringDate).toBeInstanceOf(Date);
        expect(arg.data.nextRecurringDate.getTime()).toBeGreaterThan(Date.now());
    });
});
