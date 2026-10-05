import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockSettlementCreate = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockMembershipFindMany = vi.fn();
const mockPostSettlementLedger = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/ledger', () => ({ postSettlementLedger: (...a: unknown[]) => mockPostSettlementLedger(...a) }));
vi.mock('@/lib/db', () => {
    const settlement = { create: (...a: unknown[]) => mockSettlementCreate(...a) };
    return {
        prisma: {
            settlement,
            couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
            membership: {
                findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a),
                findMany: (...a: unknown[]) => mockMembershipFindMany(...a),
                // getPrimaryGroup fallback (no active_group cookie): u1's group is c1.
                findFirst: async () => ({ groupId: 'c1' }),
            },
            $transaction: (cb: (tx: unknown) => unknown) => cb({ settlement }),
        },
    };
});

import { POST } from './route';

function req(body: unknown) {
    return new Request('http://localhost/api/settle', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/settle — paid (PENDING) vs received (creditor auto-confirm)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCoupleFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({ id, status: 'ACTIVE' }));
        // u1 and u2 are ACTIVE members of c1 only.
        mockMembershipFindUnique.mockImplementation(async ({ where: { groupId_userId } }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
            groupId_userId.groupId === 'c1'
                ? { groupId: 'c1', userId: groupId_userId.userId, role: 'MEMBER', status: 'ACTIVE' }
                : null,
        );
        mockMembershipFindMany.mockResolvedValue([{ user: { id: 'u1' } }, { user: { id: 'u2' } }]);
        mockSettlementCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', date: new Date(), ...data }));
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await POST(req({ toUserId: 'u2', amount: 10 }));
        expect(res.status).toBe(401);
    });

    it('"Ya he pagado" creates a PENDING settlement caller → creditor and posts no ledger', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 12.5, method: 'BIZUM', groupId: 'c1' }));
        expect(res.status).toBe(200);
        expect(mockSettlementCreate).toHaveBeenCalledWith({
            data: { amount: 1250, fromUserId: 'u1', toUserId: 'u2', coupleId: 'c1', method: 'BIZUM', status: 'PENDING' },
        });
        expect(mockPostSettlementLedger).not.toHaveBeenCalled();
        expect((await res.json()).settlement.status).toBe('PENDING');
    });

    it('"Ya me ha pagado" creates a CONFIRMED settlement debtor → caller and posts the ledger', async () => {
        const res = await POST(req({ fromUserId: 'u2', amount: 20, method: 'CASH', groupId: 'c1' }));
        expect(res.status).toBe(200);
        expect(mockSettlementCreate).toHaveBeenCalledWith({
            data: { amount: 2000, fromUserId: 'u2', toUserId: 'u1', coupleId: 'c1', method: 'CASH', status: 'CONFIRMED' },
        });
        expect(mockPostSettlementLedger).toHaveBeenCalledTimes(1);
        expect(mockPostSettlementLedger.mock.calls[0][1]).toMatchObject({ fromUserId: 'u2', toUserId: 'u1', amount: 2000, coupleId: 'c1' });
    });

    it('falls back to the active group when no groupId is sent', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 5 }));
        expect(res.status).toBe(200);
        expect(mockSettlementCreate.mock.calls[0][0].data.coupleId).toBe('c1');
    });

    it('a received settlement cannot be addressed to someone else', async () => {
        const res = await POST(req({ fromUserId: 'u2', toUserId: 'u3', amount: 20, groupId: 'c1' }));
        expect(res.status).toBe(400);
        expect(mockSettlementCreate).not.toHaveBeenCalled();
    });

    it('a received settlement needs a positive amount (no auto-confirmed checkpoints)', async () => {
        const res = await POST(req({ fromUserId: 'u2', amount: 0, groupId: 'c1' }));
        expect(res.status).toBe(400);
    });

    it('rejects settling with yourself in either direction', async () => {
        expect((await POST(req({ toUserId: 'u1', amount: 1 }))).status).toBe(400);
        expect((await POST(req({ fromUserId: 'u1', amount: 1 }))).status).toBe(400);
    });

    it('403 when the counterparty is not a member of the space', async () => {
        const res = await POST(req({ fromUserId: 'u9', amount: 20, groupId: 'c1' }));
        expect(res.status).toBe(403);
        expect(mockSettlementCreate).not.toHaveBeenCalled();
    });

    it('403 when the caller is not a member of the requested space', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 20, groupId: 'other' }));
        expect(res.status).toBe(403);
    });

    it('409 on an ARCHIVED space; SETTLING still allows settling', async () => {
        mockCoupleFindUnique.mockResolvedValueOnce({ id: 'c1', status: 'ARCHIVED' });
        expect((await POST(req({ toUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(409);
        mockCoupleFindUnique.mockResolvedValueOnce({ id: 'c1', status: 'SETTLING' });
        expect((await POST(req({ fromUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(200);
    });

    it('a guest may record a payment made but never confirm one received', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1', kind: 'guest', groupId: 'c1' });
        // getSessionCtx revalidates the guest membership (include group status).
        mockMembershipFindUnique.mockImplementation(async () => ({
            groupId: 'c1', userId: 'u1', role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' },
        }));
        expect((await POST(req({ fromUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(403);
        expect((await POST(req({ toUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(200);
    });
});
