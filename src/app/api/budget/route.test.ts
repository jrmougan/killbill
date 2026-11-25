import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockMembershipFindFirst = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockBudgetFindMany = vi.fn();
const mockBudgetFindUnique = vi.fn();
const mockBudgetUpsert = vi.fn();
const mockBudgetDeleteMany = vi.fn();
const mockExpenseFindMany = vi.fn();
const mockCategoryFindFirst = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// No active-group cookie in tests → getActiveGroup falls back to getPrimaryGroup
// (mocked prisma.membership.findFirst below).
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/db', () => ({
    prisma: {
        // getPrimaryGroup resolves the caller's group with findFirst;
        // requireSpaceAccess re-checks the DB membership with findUnique.
        membership: {
            findFirst: (...a: unknown[]) => mockMembershipFindFirst(...a),
            findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a),
        },
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        budget: {
            findMany: (...a: unknown[]) => mockBudgetFindMany(...a),
            findUnique: (...a: unknown[]) => mockBudgetFindUnique(...a),
            upsert: (...a: unknown[]) => mockBudgetUpsert(...a),
            deleteMany: (...a: unknown[]) => mockBudgetDeleteMany(...a),
        },
        expense: { findMany: (...a: unknown[]) => mockExpenseFindMany(...a) },
        category: { findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a) },
    },
}));

import { GET, POST, DELETE } from './route';

const ALL = [
    mockGetSession, mockMembershipFindFirst, mockMembershipFindUnique, mockCoupleFindUnique,
    mockBudgetFindMany, mockBudgetFindUnique, mockBudgetUpsert, mockBudgetDeleteMany,
    mockExpenseFindMany, mockCategoryFindFirst,
];

/** The caller is an ACTIVE `role` member of space `id` with the given type/status. */
function memberOf(id: string, opts: { status?: string; type?: string; role?: string } = {}) {
    mockCoupleFindUnique.mockResolvedValue({ id, type: opts.type ?? 'COUPLE', status: opts.status ?? 'ACTIVE' });
    mockMembershipFindUnique.mockResolvedValue({ groupId: id, role: opts.role ?? 'MEMBER', status: 'ACTIVE' });
}

/** A guest session whose DB membership is still ACTIVE (passes getSessionCtx). */
function guestSession(groupId = 'trip') {
    mockGetSession.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId });
    mockMembershipFindUnique.mockResolvedValue({ role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' } });
}

const post = (body: unknown) => POST(new Request('http://localhost/api/budget', { method: 'POST', body: JSON.stringify(body) }));
const del = (qs: string) => DELETE(new Request(`http://localhost/api/budget?${qs}`, { method: 'DELETE' }));

beforeEach(() => ALL.forEach((m) => m.mockReset()));

describe('budget API — DELETE', () => {
    it('rejects anonymous callers', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await del('id=b1')).status).toBe(401);
        expect(mockBudgetDeleteMany).not.toHaveBeenCalled();
    });

    it('requires an id', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        expect((await del('scope=personal')).status).toBe(400);
    });

    it('rejects a guest session (403) without touching the budget', async () => {
        guestSession();
        expect((await del('id=b1&scope=shared')).status).toBe(403);
        expect(mockBudgetFindUnique).not.toHaveBeenCalled();
        expect(mockBudgetDeleteMany).not.toHaveBeenCalled();
    });

    it('deletes a caller-owned personal budget', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue({ id: 'b1', ownerId: 'u1', coupleId: null });
        mockBudgetDeleteMany.mockResolvedValue({ count: 1 });
        expect((await del('id=b1&scope=personal')).status).toBe(200);
        expect(mockBudgetDeleteMany.mock.calls[0][0].where).toEqual({ id: 'b1', ownerId: 'u1' });
    });

    it("404s on someone else's personal budget", async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue({ id: 'b1', ownerId: 'u2', coupleId: null });
        expect((await del('id=b1&scope=personal')).status).toBe(404);
        expect(mockBudgetDeleteMany).not.toHaveBeenCalled();
    });

    it('authorizes a shared budget against ITS space, not the active cookie', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue({ id: 'b1', ownerId: null, coupleId: 'c9' });
        memberOf('c9');
        mockBudgetDeleteMany.mockResolvedValue({ count: 1 });
        expect((await del('id=b1&scope=shared')).status).toBe(200);
        expect(mockMembershipFindUnique.mock.calls[0][0].where).toEqual({ groupId_userId: { groupId: 'c9', userId: 'u1' } });
        expect(mockBudgetDeleteMany.mock.calls[0][0].where).toEqual({ id: 'b1', coupleId: 'c9' });
    });

    it('404s (no existence leak) when the caller is not a member of the budget space', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue({ id: 'b1', ownerId: null, coupleId: 'foreign' });
        mockCoupleFindUnique.mockResolvedValue({ id: 'foreign', type: 'COUPLE', status: 'ACTIVE' });
        mockMembershipFindUnique.mockResolvedValue(null);
        expect((await del('id=b1')).status).toBe(404);
        expect(mockBudgetDeleteMany).not.toHaveBeenCalled();
    });

    it.each(['ARCHIVED', 'SETTLING'])('rejects deleting in a %s space with 409 SPACE_NOT_WRITABLE', async (status) => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue({ id: 'b1', ownerId: null, coupleId: 'c1' });
        memberOf('c1', { status });
        const res = await del('id=b1');
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('SPACE_NOT_WRITABLE');
        expect(mockBudgetDeleteMany).not.toHaveBeenCalled();
    });

    it('404s on an unknown id', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindUnique.mockResolvedValue(null);
        expect((await del('id=nope')).status).toBe(404);
    });
});

describe('budget API — POST shared', () => {
    it('rejects a guest session (403)', async () => {
        guestSession();
        const res = await post({ category: 'food', amount: 50 });
        expect(res.status).toBe(403);
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });

    it.each(['ARCHIVED', 'SETTLING'])('rejects writes in a %s space with 409 SPACE_NOT_WRITABLE', async (status) => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        memberOf('c1', { status });
        const res = await post({ category: 'food', amount: 50 });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('SPACE_NOT_WRITABLE');
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });

    it('rejects budgets in an EPHEMERAL space', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        memberOf('trip', { type: 'EPHEMERAL', role: 'OWNER' });
        const res = await post({ category: 'food', amount: 50, groupId: 'trip' });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('BUDGETS_NOT_ALLOWED');
    });

    it('authorizes an explicit groupId against the DB membership (403 when not a member)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCoupleFindUnique.mockResolvedValue({ id: 'other', type: 'COUPLE', status: 'ACTIVE' });
        mockMembershipFindUnique.mockResolvedValue(null);
        const res = await post({ category: 'food', amount: 50, groupId: 'other' });
        expect(res.status).toBe(403);
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });

    it('upserts on the explicit space when the caller is an active member', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        memberOf('c2');
        mockCategoryFindFirst.mockResolvedValue({ id: 'cat-food' });
        mockBudgetUpsert.mockResolvedValue({ id: 'b1' });
        const res = await post({ category: 'food', amount: '1.234,56', groupId: 'c2' });
        expect(res.status).toBe(201);
        const arg = mockBudgetUpsert.mock.calls[0][0];
        expect(arg.create.coupleId).toBe('c2');
        expect(arg.create.amount).toBe(123456);
    });

    it('scope=shared without a space is rejected (400)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);
        expect((await post({ scope: 'shared', category: 'health', amount: 100 })).status).toBe(400);
    });
});

describe('budget API — amount validation (400, never a 500 overflow)', () => {
    it.each([
        [99999999, /máximo/],
        [1e12, /máximo/],
        ['99.999.999', /máximo/],
        [0, /al menos/],
        [-5, /al menos/],
        [0.001, /al menos/],
        ['abc', /no es válido/],
        [{ x: 1 }, /no es válido/],
        [null, /obligatorios/],
    ])('amount %s → 400', async (amount, msg) => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        const res = await post({ scope: 'personal', category: 'food', amount });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(msg);
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });

    it('accepts exactly 1.000.000 €', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCategoryFindFirst.mockResolvedValue({ id: 'cat' });
        mockBudgetUpsert.mockResolvedValue({ id: 'b1' });
        expect((await post({ scope: 'personal', category: 'food', amount: 1_000_000 })).status).toBe(201);
        expect(mockBudgetUpsert.mock.calls[0][0].create.amount).toBe(100_000_000);
    });

    it('rejects a malformed month', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        expect((await post({ scope: 'personal', category: 'food', amount: 5, month: '2026-13' })).status).toBe(400);
        expect((await post({ scope: 'personal', category: 'food', amount: 5, month: 'x' })).status).toBe(400);
    });

    it('rejects an invalid JSON body', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        const res = await POST(new Request('http://localhost/api/budget', { method: 'POST', body: '{' }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Cuerpo de la petición no válido' });
    });

    it('400 shapes: INVALID_AMOUNT only for a bad amount, issues on every field error', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        expect(await (await post({ scope: 'personal', category: 'food', amount: 'abc' })).json())
            .toMatchObject({ error: 'El importe no es válido', code: 'INVALID_AMOUNT', issues: [{ path: 'amount' }] });
        const missing = await (await post({ scope: 'personal', amount: 5 })).json();
        expect(missing).toMatchObject({ error: 'La categoría y el importe son obligatorios', issues: [{ path: 'category' }] });
        expect(missing.code).toBeUndefined();
        expect((await (await post({ scope: 'personal', category: 'food' })).json()).code).toBeUndefined();
        expect(await (await post({ scope: 'personal', category: 'food', amount: 5, month: 202601 })).json())
            .toMatchObject({ error: 'El mes no es válido (formato AAAA-MM)', issues: [{ path: 'month' }] });
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });

    it('stores an explicit month as its first local day', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCategoryFindFirst.mockResolvedValue({ id: 'cat' });
        mockBudgetUpsert.mockResolvedValue({ id: 'b1' });
        expect((await post({ scope: 'personal', category: 'food', amount: 5, month: '2026-02' })).status).toBe(201);
        const { periodStart, periodEnd } = mockBudgetUpsert.mock.calls[0][0].create;
        expect(periodStart).toEqual(new Date(2026, 1, 1));
        expect(periodEnd).toEqual(new Date(2026, 2, 1));
    });
});

describe('budget API — GET', () => {
    it('rejects a guest session (403)', async () => {
        guestSession();
        expect((await GET(new Request('http://localhost/api/budget?scope=shared'))).status).toBe(403);
        expect(mockBudgetFindMany).not.toHaveBeenCalled();
    });

    it('scope=personal filters budgets + spend by ownerId and PERSONAL expenses', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetFindMany.mockResolvedValue([]);
        mockExpenseFindMany.mockResolvedValue([]);

        const res = await GET(new Request('http://localhost/api/budget?scope=personal'));
        expect(res.status).toBe(200);

        const budgetWhere = mockBudgetFindMany.mock.calls[0][0].where;
        expect(budgetWhere.ownerId).toBe('u1');
        expect(budgetWhere.coupleId).toBeUndefined();

        const expenseWhere = mockExpenseFindMany.mock.calls[0][0].where;
        expect(expenseWhere.ownerId).toBe('u1');
        expect(expenseWhere.visibility).toBe('PERSONAL');
    });

    it('scope=shared returns empty for a user with no space', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);
        const res = await GET(new Request('http://localhost/api/budget?scope=shared'));
        expect(res.status).toBe(200);
        expect((await res.json()).budgets).toEqual([]);
        expect(mockBudgetFindMany).not.toHaveBeenCalled();
    });

    it('scope=shared reads an ARCHIVED space (read-only is fine)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        memberOf('c1', { status: 'ARCHIVED' });
        mockBudgetFindMany.mockResolvedValue([]);
        mockExpenseFindMany.mockResolvedValue([]);
        const res = await GET(new Request('http://localhost/api/budget?scope=shared'));
        expect(res.status).toBe(200);
        expect(mockBudgetFindMany.mock.calls[0][0].where.coupleId).toBe('c1');
    });
});

describe('budget API — POST personal', () => {
    it('upserts on categoryId+periodStart+ownerId with ownerId set', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockBudgetUpsert.mockResolvedValue({ id: 'b1' });
        mockCategoryFindFirst.mockResolvedValue({ id: 'cat-health' });

        const res = await post({ scope: 'personal', category: 'health', amount: 100 });
        expect(res.status).toBe(201);

        const arg = mockBudgetUpsert.mock.calls[0][0];
        expect(arg.where.categoryId_periodStart_ownerId.ownerId).toBe('u1');
        expect(arg.where.categoryId_periodStart_ownerId.categoryId).toBe('cat-health');
        expect(arg.where.categoryId_periodStart_ownerId.periodStart).toEqual(arg.create.periodStart);
        expect(arg.create.ownerId).toBe('u1');
        expect(arg.create.amount).toBe(10000); // 100€ → cents
        expect(arg.create.category).toBeUndefined();
        expect(arg.create.month).toBeUndefined();
        expect(arg.create.periodType).toBe('MONTH');
        expect(arg.create.periodEnd.getTime()).toBeGreaterThan(arg.create.periodStart.getTime());
        expect(arg.create.periodEnd.getDate()).toBe(1); // first day of the next month
        // Personal budgets never touch a space.
        expect(mockCoupleFindUnique).not.toHaveBeenCalled();
    });

    it('returns 400 when the category cannot be resolved', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCategoryFindFirst.mockResolvedValue(null);
        expect((await post({ scope: 'personal', category: 'health', amount: 100 })).status).toBe(400);
        expect(mockBudgetUpsert).not.toHaveBeenCalled();
    });
});
