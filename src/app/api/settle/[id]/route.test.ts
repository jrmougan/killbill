import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockSettlementFindUnique = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockEdit = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Conditional update / caps / races: settlement-service.test.ts.
vi.mock('@/lib/settlement-service', () => ({ editSettlement: (...a: unknown[]) => mockEdit(...a) }));
vi.mock('@/lib/db', () => ({
    prisma: {
        settlement: { findUnique: (...a: unknown[]) => mockSettlementFindUnique(...a) },
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
    },
}));

import { PATCH } from './route';
import { SettlementError } from '@/lib/settlement-rules';

const params = Promise.resolve({ id: 's1' });
function req(body: unknown) {
    return new Request('http://localhost/api/settle/s1', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('PATCH /api/settle/[id] (edit a PENDING settlement)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockSettlementFindUnique.mockResolvedValue({ coupleId: 'c1' });
        mockCoupleFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({ id, status: 'ACTIVE' }));
        mockMembershipFindUnique.mockImplementation(async ({ where: { groupId_userId } }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
            groupId_userId.groupId === 'c1'
                ? { groupId: 'c1', userId: groupId_userId.userId, role: 'MEMBER', status: 'ACTIVE' }
                : null,
        );
        mockEdit.mockResolvedValue({ id: 's1', status: 'PENDING', amount: 4500, method: 'CASH' });
    });

    it('edits amount (euros → cents) and method', async () => {
        const res = await PATCH(req({ amount: 45, method: 'CASH' }), { params });
        expect(res.status).toBe(200);
        expect(mockEdit).toHaveBeenCalledWith({ settlementId: 's1', groupId: 'c1', callerId: 'u2', cents: 4500, method: 'CASH' });
        expect((await res.json()).settlement).toEqual({ id: 's1', status: 'PENDING', amount: 4500, method: 'CASH' });
    });

    it.each([[0], [0.004], [''], ['45'], [[]], [true], [null], [1e12]])('400 INVALID_AMOUNT for %j', async (amount) => {
        const res = await PATCH(req({ amount }), { params });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('INVALID_AMOUNT');
        expect(mockEdit).not.toHaveBeenCalled();
    });

    it('400 on an invalid method', async () => {
        expect((await PATCH(req({ method: 'PAYPAL' }), { params })).status).toBe(400);
    });

    it('404 / 403 for unknown settlements or foreign spaces', async () => {
        mockSettlementFindUnique.mockResolvedValueOnce(null);
        expect((await PATCH(req({ amount: 1 }), { params })).status).toBe(404);
        mockSettlementFindUnique.mockResolvedValueOnce({ coupleId: 'other' });
        expect((await PATCH(req({ amount: 1 }), { params })).status).toBe(403);
    });

    it.each([
        [403, 'NOT_PAYER'], [409, 'SETTLEMENT_NOT_PENDING'], [409, 'SPACE_NOT_WRITABLE'], [409, 'SETTLEMENT_EXCEEDS_DEBT'],
    ])('maps service failure %i %s', async (status, code) => {
        mockEdit.mockRejectedValueOnce(new SettlementError(status, code, 'msg'));
        const res = await PATCH(req({ amount: 1 }), { params });
        expect(res.status).toBe(status);
        expect((await res.json()).code).toBe(code);
    });

    it('a guest may edit their own PENDING payment (S-08)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId: 'c1' });
        mockMembershipFindUnique.mockImplementation(async () => ({
            groupId: 'c1', userId: 'g1', role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' },
        }));
        expect((await PATCH(req({ amount: 10 }), { params })).status).toBe(200);
        expect(mockEdit.mock.calls[0][0].callerId).toBe('g1');
    });
});
