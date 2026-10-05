import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockSettlementFindUnique = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockResolve = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Transition rules, caps and races are covered by settlement-service.test.ts.
vi.mock('@/lib/settlement-service', () => ({ resolveSettlement: (...a: unknown[]) => mockResolve(...a) }));
vi.mock('@/lib/db', () => ({
    prisma: {
        settlement: { findUnique: (...a: unknown[]) => mockSettlementFindUnique(...a) },
        // requireSpaceAccess authorizes against the settlement's OWN group.
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
    },
}));

import { PATCH } from './route';
import { SettlementError } from '@/lib/settlement-rules';

const params = Promise.resolve({ id: 's1' });
function req(body: unknown) {
    return new Request('http://localhost/api/settle/s1/status', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('PATCH /api/settle/[id]/status', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSettlementFindUnique.mockResolvedValue({ coupleId: 'c1' });
        mockCoupleFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({ id, status: 'ACTIVE' }));
        mockMembershipFindUnique.mockImplementation(async ({ where: { groupId_userId } }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
            groupId_userId.groupId === 'c1'
                ? { groupId: 'c1', userId: groupId_userId.userId, role: 'MEMBER', status: 'ACTIVE' }
                : null,
        );
        mockResolve.mockResolvedValue({ id: 's1', status: 'CONFIRMED', amount: 5000 });
    });

    it('401 when there is no session', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await PATCH(req({ status: 'CONFIRMED' }), { params })).status).toBe(401);
    });

    it('400 on an invalid status (PENDING included) or expectedAmountCents', async () => {
        expect((await PATCH(req({ status: 'BOGUS' }), { params })).status).toBe(400);
        expect((await PATCH(req({ status: 'PENDING' }), { params })).status).toBe(400);
        expect((await PATCH(req({ status: 'CONFIRMED', expectedAmountCents: '50' }), { params })).status).toBe(400);
        expect((await PATCH(req({ status: 'CONFIRMED', expectedAmountCents: 1.5 }), { params })).status).toBe(400);
        expect(mockResolve).not.toHaveBeenCalled();
    });

    it('404 when the settlement does not exist', async () => {
        mockSettlementFindUnique.mockResolvedValue(null);
        expect((await PATCH(req({ status: 'CONFIRMED' }), { params })).status).toBe(404);
    });

    it('403 when the settlement belongs to a space the caller is not in', async () => {
        mockSettlementFindUnique.mockResolvedValue({ coupleId: 'other' });
        expect((await PATCH(req({ status: 'CONFIRMED' }), { params })).status).toBe(403);
        expect(mockResolve).not.toHaveBeenCalled();
    });

    it('passes the receiver, the target status and the amount they saw to the service', async () => {
        const res = await PATCH(req({ status: 'CONFIRMED', expectedAmountCents: 5000 }), { params });
        expect(res.status).toBe(200);
        expect(mockResolve).toHaveBeenCalledWith({
            settlementId: 's1', groupId: 'c1', callerId: 'u1', status: 'CONFIRMED', expectedAmountCents: 5000,
        });
    });

    it.each([
        [403, 'NOT_RECEIVER'], [409, 'SETTLEMENT_NOT_PENDING'], [409, 'SETTLEMENT_CHANGED'],
        [409, 'SETTLEMENT_EXCEEDS_DEBT'], [409, 'SPACE_NOT_WRITABLE'],
    ])('maps service failure %i %s', async (status, code) => {
        mockResolve.mockRejectedValueOnce(new SettlementError(status, code, 'msg'));
        const res = await PATCH(req({ status: 'REJECTED' }), { params });
        expect(res.status).toBe(status);
        expect((await res.json()).code).toBe(code);
    });

    it('a guest owed money may confirm/reject settlements addressed to them (S-04)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId: 'c1' });
        mockMembershipFindUnique.mockImplementation(async () => ({
            groupId: 'c1', userId: 'g1', role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' },
        }));
        expect((await PATCH(req({ status: 'CONFIRMED' }), { params })).status).toBe(200);
        expect((await PATCH(req({ status: 'REJECTED' }), { params })).status).toBe(200);
        expect(mockResolve.mock.calls[0][0].callerId).toBe('g1');
    });

    it('500 with a Spanish message on unexpected errors', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockResolve.mockRejectedValueOnce(new Error('boom'));
        const res = await PATCH(req({ status: 'CONFIRMED' }), { params });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('No se pudo actualizar el pago');
    });
});
