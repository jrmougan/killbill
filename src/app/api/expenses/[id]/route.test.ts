import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockExpenseDelete = vi.fn();
const mockExpenseUpdate = vi.fn();
const mockSplitFindMany = vi.fn();
const mockTxSeriesUpdate = vi.fn();
const mockGetGroupMembers = vi.fn();
const mockPostExpenseLedger = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Phase 5 (WS1): DELETE authz resolves members via the Membership layer.
vi.mock('@/lib/membership', () => ({ getGroupMembers: (...a: unknown[]) => mockGetGroupMembers(...a) }));
// Ledger posting is covered by reconcile-ledger.ts + the ledger tests; stub it
// here so the PATCH tests stay focused on payer-change authz + re-attribution.
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: (...a: unknown[]) => mockPostExpenseLedger(...a) }));
vi.mock('@/lib/db', () => {
    const expense = {
        findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a),
        delete: (...a: unknown[]) => mockExpenseDelete(...a),
        update: (...a: unknown[]) => mockExpenseUpdate(...a),
    };
    const split = {
        findMany: (...a: unknown[]) => mockSplitFindMany(...a),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        create: vi.fn(),
    };
    const receiptLineItem = { deleteMany: vi.fn(), createMany: vi.fn() };
    const recurringSeries = { update: (...a: unknown[]) => mockTxSeriesUpdate(...a), create: vi.fn() };
    return {
        prisma: {
            expense,
            split,
            // DELETE and PATCH both wrap their writes in a $transaction; run the
            // callback against a tx double exposing the same model mocks. Phase 5:
            // the series is deactivated only when series.templateId === the id.
            $transaction: (cb: (tx: unknown) => unknown) =>
                cb({ expense, split, receiptLineItem, recurringSeries }),
        },
    };
});

import { DELETE, PATCH } from './route';

const params = Promise.resolve({ id: 'e1' });
function req() {
    return new Request('http://localhost/api/expenses/e1', { method: 'DELETE' });
}

// A shared expense owned by u1 (creator), scoped to couple c1 with members u1,u2.
function sharedExpense(overrides = {}) {
    return {
        id: 'e1', visibility: 'SHARED', ownerId: 'u1', paidById: 'u1', coupleId: 'c1',
        ...overrides,
    };
}
function personalExpense(overrides = {}) {
    return { id: 'e1', visibility: 'PERSONAL', ownerId: 'u1', paidById: 'u1', coupleId: null, ...overrides };
}

describe('DELETE /api/expenses/[id] — authorization', () => {
    beforeEach(() => {
        mockGetSession.mockReset();
        mockExpenseFindUnique.mockReset();
        mockExpenseDelete.mockReset();
        mockTxSeriesUpdate.mockReset();
        mockGetGroupMembers.mockReset();
        mockExpenseDelete.mockResolvedValue({});
        mockTxSeriesUpdate.mockResolvedValue({});
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(401);
    });

    it('404 when the expense does not exist', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(null);
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(404);
    });

    it('lets a current couple member delete a shared expense', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockExpenseFindUnique.mockResolvedValue(sharedExpense());
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseDelete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });

    it('403 for an EX-member who still owns a shared expense (unlinked)', async () => {
        // u1 created the expense (ownerId=u1) but has left the couple, so the
        // Membership member list no longer includes u1. isOwner must NOT grant access.
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetGroupMembers.mockResolvedValue([{ id: 'u2' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense());
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(403);
        expect(mockExpenseDelete).not.toHaveBeenCalled();
    });

    it('lets the owner delete their personal expense', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(personalExpense());
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(200);
    });

    it('403 when another user tries to delete a personal expense', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockExpenseFindUnique.mockResolvedValue(personalExpense());
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(403);
        expect(mockExpenseDelete).not.toHaveBeenCalled();
    });

    it('deactivates the series when deleting the recurring TEMPLATE (Phase 5: series.templateId === id)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(personalExpense({
            seriesId: 's1', series: { id: 's1', templateId: 'e1' },
        }));
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(200);
        expect(mockTxSeriesUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isActive: false } });
        expect(mockExpenseDelete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });

    it('does NOT deactivate the series when deleting a materialized INSTANCE', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(personalExpense({
            seriesId: 's1', series: { id: 's1', templateId: 'tpl-other' },
        }));
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(200);
        expect(mockTxSeriesUpdate).not.toHaveBeenCalled();
        expect(mockExpenseDelete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });
});

function patchReq(body: unknown) {
    return new Request('http://localhost/api/expenses/e1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PATCH /api/expenses/[id] — payer change (N-way)', () => {
    beforeEach(() => {
        [mockGetSession, mockExpenseFindUnique, mockExpenseUpdate, mockSplitFindMany, mockGetGroupMembers, mockPostExpenseLedger].forEach((m) => m.mockReset());
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        // A three-member group; e1 is a shared 30€ expense currently paid by u1.
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 3000, series: null, lineItems: [] }));
        // Splits already sum to the amount, so the ledger re-post guard passes.
        mockSplitFindMany.mockResolvedValue([
            { userId: 'u1', amount: 1000 }, { userId: 'u2', amount: 1000 }, { userId: 'u3', amount: 1000 },
        ]);
        mockExpenseUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'e1', visibility: 'SHARED', coupleId: 'c1', amount: 3000, date: new Date(0), seriesId: null, paidById: data.paidById ?? 'u1', ...data }));
        mockPostExpenseLedger.mockResolvedValue(undefined);
    });

    it('400 when the new payer is not a member of the group', async () => {
        const res = await PATCH(patchReq({ paidById: 'stranger' }), { params });
        expect(res.status).toBe(400);
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
    });

    it('re-attributes the payer and re-posts the ledger with the new payer', async () => {
        const res = await PATCH(patchReq({ paidById: 'u2' }), { params });
        expect(res.status).toBe(200);
        // The expense row is updated to the new payer...
        expect(mockExpenseUpdate).toHaveBeenCalledOnce();
        expect(mockExpenseUpdate.mock.calls[0][0].data.paidById).toBe('u2');
        // ...and the ledger re-post carries it (splits are unchanged shares).
        expect(mockPostExpenseLedger).toHaveBeenCalledOnce();
        expect(mockPostExpenseLedger.mock.calls[0][1].paidById).toBe('u2');
    });

    it('leaves the payer untouched when paidById is omitted', async () => {
        const res = await PATCH(patchReq({ notes: 'hola' }), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseUpdate.mock.calls[0][0].data.paidById).toBeUndefined();
    });

    it('removes the receipt image when receiptUrl is null', async () => {
        const res = await PATCH(patchReq({ receiptUrl: null }), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseUpdate.mock.calls[0][0].data.receiptUrl).toBeNull();
    });

    it('sets a new receipt image when receiptUrl is a string', async () => {
        const res = await PATCH(patchReq({ receiptUrl: '/uploads/new.jpg' }), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseUpdate.mock.calls[0][0].data.receiptUrl).toBe('/uploads/new.jpg');
    });

    it('leaves the receipt untouched when receiptUrl is omitted', async () => {
        const res = await PATCH(patchReq({ notes: 'x' }), { params });
        expect(res.status).toBe(200);
        expect('receiptUrl' in mockExpenseUpdate.mock.calls[0][0].data).toBe(false);
    });
});
