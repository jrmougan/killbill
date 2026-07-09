import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockExpenseDelete = vi.fn();
const mockTxSeriesUpdate = vi.fn();
const mockGetGroupMembers = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Phase 5 (WS1): DELETE authz resolves members via the Membership layer.
vi.mock('@/lib/membership', () => ({ getGroupMembers: (...a: unknown[]) => mockGetGroupMembers(...a) }));
vi.mock('@/lib/db', () => {
    const expense = {
        findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a),
        delete: (...a: unknown[]) => mockExpenseDelete(...a),
    };
    return {
        prisma: {
            expense,
            // DELETE wraps the delete (and a conditional series deactivation) in a
            // $transaction; run the callback against a tx double exposing the same
            // expense mock plus recurringSeries.update/create. Phase 5: the series is
            // deactivated only when series.templateId === the deleted expense id.
            $transaction: (cb: (tx: unknown) => unknown) =>
                cb({ expense, recurringSeries: { update: (...a: unknown[]) => mockTxSeriesUpdate(...a), create: vi.fn() } }),
        },
    };
});

import { DELETE } from './route';

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
