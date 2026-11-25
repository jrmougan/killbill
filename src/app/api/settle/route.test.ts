import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockMembershipFindMany = vi.fn();
const mockCreateSettlement = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
// The DB rules (lock, caps, merge with PENDING) are covered by
// src/lib/settlement-service.test.ts; here: parsing, validation and authz.
vi.mock('@/lib/settlement-service', () => ({ createSettlement: (...a: unknown[]) => mockCreateSettlement(...a) }));
vi.mock('@/lib/db', () => ({
    prisma: {
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: {
            findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a),
            findMany: (...a: unknown[]) => mockMembershipFindMany(...a),
            // getPrimaryGroup fallback (no active_group cookie): u1's group is c1.
            findFirst: async () => ({ groupId: 'c1' }),
        },
    },
}));

import { POST } from './route';
import { SettlementError } from '@/lib/settlement-rules';

function req(body: unknown) {
    return new Request('http://localhost/api/settle', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('POST /api/settle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCoupleFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({ id, status: 'ACTIVE', type: 'COUPLE' }));
        // u1 and u2 are ACTIVE members of c1 only.
        mockMembershipFindUnique.mockImplementation(async ({ where: { groupId_userId } }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
            groupId_userId.groupId === 'c1'
                ? { groupId: 'c1', userId: groupId_userId.userId, role: 'MEMBER', status: 'ACTIVE' }
                : null,
        );
        mockMembershipFindMany.mockResolvedValue([{ user: { id: 'u1' } }, { user: { id: 'u2' } }]);
        mockCreateSettlement.mockImplementation(async (input: { direction: string; cents: number }) => ({
            id: 's1', status: input.direction === 'paid' ? 'PENDING' : 'CONFIRMED', amount: input.cents, merged: false,
        }));
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await POST(req({ toUserId: 'u2', amount: 10 }));
        expect(res.status).toBe(401);
    });

    it('"Ya he pagado" → paid, caller → creditor, amount in cents', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 12.5, method: 'BIZUM', groupId: 'c1' }));
        expect(res.status).toBe(200);
        expect(mockCreateSettlement).toHaveBeenCalledWith({
            groupId: 'c1', callerId: 'u1', counterpartyId: 'u2', direction: 'paid', cents: 1250, method: 'BIZUM',
        });
        expect(await res.json()).toEqual({ success: true, settlement: { id: 's1', status: 'PENDING', amount: 1250 }, merged: false });
    });

    it('"Ya me ha pagado" → received from the debtor; method defaults to CASH', async () => {
        const res = await POST(req({ fromUserId: 'u2', amount: 20, groupId: 'c1' }));
        expect(res.status).toBe(200);
        expect(mockCreateSettlement).toHaveBeenCalledWith(expect.objectContaining({ direction: 'received', counterpartyId: 'u2', cents: 2000, method: 'CASH' }));
        expect((await res.json()).settlement.status).toBe('CONFIRMED');
    });

    it('received tolerates toUserId: null or the caller, rejects someone else', async () => {
        expect((await POST(req({ fromUserId: 'u2', toUserId: null, amount: 1, groupId: 'c1' }))).status).toBe(200);
        expect((await POST(req({ fromUserId: 'u2', toUserId: 'u1', amount: 1, groupId: 'c1' }))).status).toBe(200);
        expect((await POST(req({ fromUserId: 'u2', toUserId: 'u3', amount: 1, groupId: 'c1' }))).status).toBe(400);
    });

    it('falls back to the active group when no groupId is sent', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 5 }));
        expect(res.status).toBe(200);
        expect(mockCreateSettlement.mock.calls[0][0].groupId).toBe('c1');
    });

    it.each([
        ['zero', 0], ['negative', -5], ['below one cent', 0.004], ['empty string', ''], ['numeric string', '12'],
        ['array', []], ['boolean', true], ['null', null], ['missing', undefined], ['NaN-ish object', {}],
        ['huge', 1e12], ['just over 1M €', 1_000_000.01],
    ])('400 INVALID_AMOUNT for %s', async (_label, amount) => {
        const res = await POST(req({ toUserId: 'u2', amount, groupId: 'c1' }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('INVALID_AMOUNT');
        expect(mockCreateSettlement).not.toHaveBeenCalled();
    });

    it('accepts exactly 1.000.000 € and 0,005 € (rounds to 1 cent)', async () => {
        expect((await POST(req({ toUserId: 'u2', amount: 1_000_000, groupId: 'c1' }))).status).toBe(200);
        expect((await POST(req({ toUserId: 'u2', amount: 0.005, groupId: 'c1' }))).status).toBe(200);
        expect(mockCreateSettlement.mock.calls[1][0].cents).toBe(1);
    });

    it('400 on malformed input: non-string groupId, bad method, bad JSON, bad toUserId', async () => {
        expect((await POST(req({ toUserId: 'u2', amount: 1, groupId: 123 }))).status).toBe(400);
        expect((await POST(req({ toUserId: 'u2', amount: 1, method: 'PAYPAL' }))).status).toBe(400);
        expect((await POST(req('{not json'))).status).toBe(400);
        expect((await POST(req([1, 2]))).status).toBe(400);
        expect((await POST(req({ toUserId: 42, amount: 1 }))).status).toBe(400);
        expect(mockCreateSettlement).not.toHaveBeenCalled();
    });

    it('400s keep their code: INVALID_INPUT for bad JSON / fields (with issues), INVALID_AMOUNT for the amount', async () => {
        expect(await (await POST(req('{not json'))).json()).toMatchObject({ error: 'Petición no válida', code: 'INVALID_INPUT' });
        const missing = await (await POST(req({ amount: 1 }))).json();
        expect(missing).toMatchObject({ error: 'Falta toUserId', code: 'INVALID_INPUT', issues: [{ path: 'toUserId' }] });
        const bad = await (await POST(req({ toUserId: 'u2', amount: 1, method: 'PAYPAL' }))).json();
        expect(bad).toMatchObject({ error: 'Método de pago no válido', code: 'INVALID_INPUT', issues: [{ path: 'method' }] });
        const amount = await (await POST(req({ toUserId: 'u2', amount: '12' }))).json();
        expect(amount).toMatchObject({ code: 'INVALID_AMOUNT', issues: [{ path: 'amount' }] });
        expect((await (await POST(req({ fromUserId: '', amount: 1 }))).json()).error).toBe('fromUserId no válido');
        expect(mockCreateSettlement).not.toHaveBeenCalled();
    });

    it('rejects settling with yourself in either direction', async () => {
        expect((await POST(req({ toUserId: 'u1', amount: 1 }))).status).toBe(400);
        expect((await POST(req({ fromUserId: 'u1', amount: 1 }))).status).toBe(400);
    });

    it('403 when the counterparty is not a member of the space', async () => {
        const res = await POST(req({ fromUserId: 'u9', amount: 20, groupId: 'c1' }));
        expect(res.status).toBe(403);
        expect(mockCreateSettlement).not.toHaveBeenCalled();
    });

    it('403 when the caller is not a member of the requested space', async () => {
        const res = await POST(req({ toUserId: 'u2', amount: 20, groupId: 'other' }));
        expect(res.status).toBe(403);
    });

    it('maps service rule failures to their status + code', async () => {
        mockCreateSettlement.mockRejectedValueOnce(new SettlementError(409, 'SETTLEMENT_PENDING_EXISTS', 'Ya hay uno', { pendingId: 'p1' }));
        const res = await POST(req({ fromUserId: 'u2', amount: 20, groupId: 'c1' }));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Ya hay uno', code: 'SETTLEMENT_PENDING_EXISTS', pendingId: 'p1' });
    });

    it('a guest may use both directions (received only reduces what is owed to them)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1', kind: 'guest', groupId: 'c1' });
        // getSessionCtx revalidates the guest membership (include group status).
        mockMembershipFindUnique.mockImplementation(async () => ({
            groupId: 'c1', userId: 'u1', role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' },
        }));
        expect((await POST(req({ fromUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(200);
        expect((await POST(req({ toUserId: 'u2', amount: 20, groupId: 'c1' }))).status).toBe(200);
        // ...but stays caged to its own space.
        expect((await POST(req({ toUserId: 'u2', amount: 20, groupId: 'c2' }))).status).toBe(403);
    });
});
