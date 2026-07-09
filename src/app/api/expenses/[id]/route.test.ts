import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockExpenseDelete = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
vi.mock('@/lib/db', () => {
    const expense = {
        findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a),
        delete: (...a: unknown[]) => mockExpenseDelete(...a),
    };
    return {
        prisma: {
            expense,
            // DELETE now wraps the delete (and a conditional series deactivation)
            // in a $transaction; run the callback against a tx double exposing the
            // same expense mock plus a no-op recurringSeries.update. The test
            // fixtures carry no isRecurring/seriesId, so the deactivation branch is
            // skipped and mockExpenseDelete is still called with { where: { id } }.
            $transaction: (cb: (tx: unknown) => unknown) =>
                cb({ expense, recurringSeries: { update: vi.fn() } }),
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
        id: 'e1', visibility: 'SHARED', ownerId: 'u1', paidById: 'u1',
        couple: { members: [{ id: 'u1' }, { id: 'u2' }] },
        ...overrides,
    };
}
function personalExpense(overrides = {}) {
    return { id: 'e1', visibility: 'PERSONAL', ownerId: 'u1', paidById: 'u1', couple: null, ...overrides };
}

describe('DELETE /api/expenses/[id] — authorization', () => {
    beforeEach(() => {
        mockGetSession.mockReset();
        mockExpenseFindUnique.mockReset();
        mockExpenseDelete.mockReset();
        mockExpenseDelete.mockResolvedValue({});
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
        // members list no longer includes u1. isOwner must NOT grant access.
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ couple: { members: [{ id: 'u2' }] } }));
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
});
