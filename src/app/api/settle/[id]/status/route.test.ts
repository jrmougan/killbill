import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockSettlementFindUnique = vi.fn();
const mockSettlementUpdate = vi.fn();
const mockMembershipFindFirst = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// No active-group cookie in tests → getActiveGroup falls back to getPrimaryGroup,
// which resolves via the mocked prisma.membership.findFirst below.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
// Ledger posting is covered by scripts/reconcile-ledger.ts + the ledger helper;
// here it is a no-op so this test stays focused on authz + transitions.
vi.mock('@/lib/ledger', () => ({ postSettlementLedger: vi.fn() }));
vi.mock('@/lib/db', () => {
    const settlement = {
        findUnique: (...a: unknown[]) => mockSettlementFindUnique(...a),
        update: (...a: unknown[]) => mockSettlementUpdate(...a),
    };
    return {
        prisma: {
            settlement,
            // getPrimaryGroup (real module) resolves the caller's group here.
            membership: { findFirst: (...a: unknown[]) => mockMembershipFindFirst(...a) },
            // Run the callback with a tx exposing the same settlement mock.
            $transaction: (cb: (tx: unknown) => unknown) => cb({ settlement }),
        },
    };
});

import { PATCH } from './route';

const params = Promise.resolve({ id: 's1' });
function req(body: unknown) {
    return new Request('http://localhost/api/settle/s1/status', {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}
// A PENDING settlement in couple c1 whose receiver (creditor) is user u1.
function pendingSettlement(overrides = {}) {
    return { id: 's1', coupleId: 'c1', toUserId: 'u1', fromUserId: 'u2', status: 'PENDING', ...overrides };
}

describe('PATCH /api/settle/[id]/status — authz + transition state machine', () => {
    beforeEach(() => {
        mockGetSession.mockReset();
        mockSettlementFindUnique.mockReset();
        mockSettlementUpdate.mockReset();
        mockMembershipFindFirst.mockReset();
    });

    it('401 when there is no session', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(401);
    });

    it('400 on an invalid status value', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        const res = await PATCH(req({ status: 'BOGUS' }), { params });
        expect(res.status).toBe(400);
    });

    it('404 when the settlement does not exist', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue(null);
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(404);
    });

    it('403 when the settlement belongs to another couple', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue(pendingSettlement({ coupleId: 'other' }));
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(403);
    });

    it('403 when a non-receiver (the debtor) tries to confirm their own payment', async () => {
        // u2 is the payer/debtor; only u1 (the receiver) may confirm.
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockSettlementFindUnique.mockResolvedValue(pendingSettlement());
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(403);
        expect(mockSettlementUpdate).not.toHaveBeenCalled();
    });

    it('confirms a PENDING settlement when the receiver acts', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue(pendingSettlement());
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        mockSettlementUpdate.mockResolvedValue(pendingSettlement({ status: 'CONFIRMED' }));
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(200);
        expect(mockSettlementUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'CONFIRMED' } });
    });

    it('rejects re-acting on an already CONFIRMED settlement (invalid transition)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue(pendingSettlement({ status: 'CONFIRMED' }));
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        const res = await PATCH(req({ status: 'REJECTED' }), { params });
        expect(res.status).toBe(400);
        expect(mockSettlementUpdate).not.toHaveBeenCalled();
    });

    it('forbids reverting a PENDING settlement back to PENDING', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue(pendingSettlement());
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        const res = await PATCH(req({ status: 'PENDING' }), { params });
        expect(res.status).toBe(400);
        expect(mockSettlementUpdate).not.toHaveBeenCalled();
    });
});
