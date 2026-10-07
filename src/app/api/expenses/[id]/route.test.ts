import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockExpenseDelete = vi.fn();
const mockExpenseUpdate = vi.fn();
const mockSplitFindMany = vi.fn();
const mockSplitCreateMany = vi.fn();
const mockSplitDeleteMany = vi.fn();
const mockTxSeriesUpdate = vi.fn();
const mockGetGroupMembers = vi.fn();
const mockPostExpenseLedger = vi.fn();
const mockCoupleFindUnique = vi.fn(async (..._a: unknown[]) => ({ status: 'ACTIVE' }) as { status: string } | null);

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Phase 5 (WS1): DELETE authz resolves members via the Membership layer.
vi.mock('@/lib/membership', () => ({ getGroupMembers: (...a: unknown[]) => mockGetGroupMembers(...a), MAX_GROUP_MEMBERS: 20 }));
// Ledger posting is covered by reconcile-ledger.ts + the ledger tests; stub it
// here so the PATCH tests stay focused on payer-change authz + re-attribution.
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: (...a: unknown[]) => mockPostExpenseLedger(...a) }));
vi.mock('@/lib/db', () => {
    const expense = {
        findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a),
        delete: (...a: unknown[]) => mockExpenseDelete(...a),
        deleteMany: (...a: unknown[]) => mockExpenseDelete(...a),
        update: (...a: unknown[]) => mockExpenseUpdate(...a),
    };
    const split = {
        findMany: (...a: unknown[]) => mockSplitFindMany(...a),
        deleteMany: (...a: unknown[]) => mockSplitDeleteMany(...a),
        createMany: (...a: unknown[]) => mockSplitCreateMany(...a),
        create: vi.fn(),
    };
    const receiptLineItem = { deleteMany: vi.fn(), createMany: vi.fn() };
    const recurringSeries = { update: (...a: unknown[]) => mockTxSeriesUpdate(...a), create: vi.fn() };
    const membership = {
        findMany: async () => ((await mockGetGroupMembers()) as { id: string }[]).map((m) => ({ userId: m.id })),
    };
    const $queryRaw = async () => {
        const space = await mockCoupleFindUnique();
        return space ? [{ status: space.status }] : [];
    };
    return {
        prisma: {
            expense,
            split,
            // getSessionCtx revalidates a GUEST session against its Membership row.
            membership: {
                ...membership,
                findUnique: async () => ({ role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' } }),
            },
            // Writability gate (SETTLING/ARCHIVED are read-only).
            couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
            // DELETE and PATCH both wrap their writes in a $transaction; run the
            // callback against a tx double exposing the same model mocks. Phase 5:
            // the series is deactivated only when series.templateId === the id.
            // A SHARED expense is written under the space lock (A3): the tx double
            // answers the `SELECT … FOR UPDATE` with the space status and the
            // in-tx roster re-read with the same members getGroupMembers returns.
            $transaction: (cb: (tx: unknown) => unknown) =>
                cb({ expense, split, receiptLineItem, recurringSeries, membership, $queryRaw }),
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

// Regression coverage for the N-way rewrite: editing a group expense of 3-4
// members must NEVER collapse the split to 2 people (the old
// `partner = members.find(...)` + `existingSplits.length === 2` heuristic did
// exactly that). Splits are recomputed from the PERSISTED splitStrategy over ALL
// current members.
describe('PATCH /api/expenses/[id] — N-way split rewrite (no 2-member collapse)', () => {
    beforeEach(() => {
        [mockGetSession, mockExpenseFindUnique, mockExpenseUpdate, mockSplitFindMany,
            mockSplitCreateMany, mockSplitDeleteMany, mockGetGroupMembers, mockPostExpenseLedger]
            .forEach((m) => m.mockReset());
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockSplitCreateMany.mockResolvedValue({});
        mockSplitDeleteMany.mockResolvedValue({});
        mockPostExpenseLedger.mockResolvedValue(undefined);
        mockExpenseUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'e1', visibility: 'SHARED', coupleId: 'c1', date: new Date(0), seriesId: null, paidById: 'u1', amount: data.amount ?? 3000, splitStrategy: data.splitStrategy }));
    });

    /** The rows passed to tx.split.createMany, or null if it was never called. */
    function createdSplits(): { userId: string; amount: number }[] | null {
        if (mockSplitCreateMany.mock.calls.length === 0) return null;
        return mockSplitCreateMany.mock.calls[0][0].data;
    }

    it('re-splits an EQUAL 3-member expense across ALL 3 on an amount edit', async () => {
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2100, splitStrategy: 'EQUAL', series: null, lineItems: [] }));
        mockSplitFindMany.mockResolvedValue([
            { userId: 'u1', amount: 700 }, { userId: 'u2', amount: 700 }, { userId: 'u3', amount: 700 },
        ]);

        const res = await PATCH(patchReq({ amount: '30.00' }), { params });
        expect(res.status).toBe(200);

        const splits = createdSplits();
        expect(splits).not.toBeNull();
        expect(splits).toHaveLength(3);                               // NOT 2 — the bug
        expect(splits!.map(s => s.userId).sort()).toEqual(['u1', 'u2', 'u3']);
        expect(splits!.reduce((s, x) => s + x.amount, 0)).toBe(3000);
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('EQUAL');
    });

    it('persists CUSTOM over all 4 members when customSplits are supplied', async () => {
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 4000, splitStrategy: 'EQUAL', series: null, lineItems: [] }));
        mockSplitFindMany.mockResolvedValue([]);

        const custom = [
            { userId: 'u1', amount: 1500 }, { userId: 'u2', amount: 1500 },
            { userId: 'u3', amount: 500 }, { userId: 'u4', amount: 500 },
        ];
        const res = await PATCH(patchReq({ amount: '40.00', customSplits: custom }), { params });
        expect(res.status).toBe(200);

        const splits = createdSplits();
        expect(splits).toHaveLength(4);
        expect(splits!.reduce((s, x) => s + x.amount, 0)).toBe(4000);
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('CUSTOM');
    });

    it('keeps the SAME single beneficiary when editing the amount of an EXCLUSIVE expense', async () => {
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2100, splitStrategy: 'EXCLUSIVE', series: null, lineItems: [] }));
        mockSplitFindMany.mockResolvedValue([{ userId: 'u2', amount: 2100 }]); // charged entirely to u2

        const res = await PATCH(patchReq({ amount: '30.00' }), { params });
        expect(res.status).toBe(200);

        const splits = createdSplits();
        expect(splits).toEqual([{ expenseId: 'e1', userId: 'u2', amount: 3000 }]);
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('EXCLUSIVE');
    });

    it('rescales a CUSTOM expense proportionally on an amount edit (no fresh customSplits)', async () => {
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 3000, splitStrategy: 'CUSTOM', series: null, lineItems: [] }));
        // Existing 2000/500/500 (Σ3000) → doubling to 6000 keeps the ratios.
        mockSplitFindMany.mockResolvedValue([
            { userId: 'u1', amount: 2000 }, { userId: 'u2', amount: 500 }, { userId: 'u3', amount: 500 },
        ]);

        const res = await PATCH(patchReq({ amount: '60.00' }), { params });
        expect(res.status).toBe(200);

        const splits = createdSplits();
        expect(splits).toHaveLength(3);
        expect(splits!.reduce((s, x) => s + x.amount, 0)).toBe(6000);
        const byUser = Object.fromEntries(splits!.map(s => [s.userId, s.amount]));
        expect(byUser).toEqual({ u1: 4000, u2: 1000, u3: 1000 });
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('CUSTOM');
    });

    it('rejects customSplits that reference a non-member (IDOR guard)', async () => {
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2000, splitStrategy: 'EQUAL', series: null, lineItems: [] }));
        const res = await PATCH(patchReq({ amount: '20.00', customSplits: [{ userId: 'u1', amount: 1000 }, { userId: 'intruder', amount: 1000 }] }), { params });
        expect(res.status).toBe(400);
        expect(mockSplitCreateMany).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/expenses/[id] — date, read-only spaces and explicit split modes', () => {
    beforeEach(() => {
        [mockGetSession, mockExpenseFindUnique, mockExpenseUpdate, mockSplitFindMany,
            mockSplitCreateMany, mockSplitDeleteMany, mockGetGroupMembers, mockPostExpenseLedger, mockCoupleFindUnique]
            .forEach((m) => m.mockReset());
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockCoupleFindUnique.mockResolvedValue({ status: 'ACTIVE' });
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2000, splitStrategy: 'EQUAL', series: null, lineItems: [] }));
        mockSplitFindMany.mockResolvedValue([{ userId: 'u1', amount: 1000 }, { userId: 'u2', amount: 1000 }]);
        mockSplitCreateMany.mockResolvedValue({});
        mockSplitDeleteMany.mockResolvedValue({});
        mockPostExpenseLedger.mockResolvedValue(undefined);
        mockExpenseUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'e1', visibility: 'SHARED', coupleId: 'c1', date: data.date ?? new Date(0), seriesId: null, paidById: 'u1', amount: data.amount ?? 2000 }));
    });

    it('accepts a valid date and stores it at 12:00 UTC', async () => {
        const res = await PATCH(patchReq({ date: '2026-09-15' }), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseUpdate.mock.calls[0][0].data.date).toEqual(new Date('2026-09-15T12:00:00.000Z'));
    });

    it.each(['2026-02-31', '1999-12-31', '9999-12-31', '15/09/2026'])('400 for an invalid date %s', async (date) => {
        const res = await PATCH(patchReq({ date }), { params });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/fecha/i);
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
    });

    it.each(['SETTLING', 'ARCHIVED'])('409 when the space is %s (read-only)', async (status) => {
        mockCoupleFindUnique.mockResolvedValue({ status });
        const res = await PATCH(patchReq({ notes: 'x' }), { params });
        expect(res.status).toBe(409);
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
        const del = await DELETE(req(), { params });
        expect(del.status).toBe(409);
    });

    it('beneficiaryId switches the split to EXCLUSIVE', async () => {
        const res = await PATCH(patchReq({ beneficiaryId: 'u2' }), { params });
        expect(res.status).toBe(200);
        expect(mockSplitCreateMany.mock.calls[0][0].data).toEqual([{ expenseId: 'e1', userId: 'u2', amount: 2000 }]);
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('EXCLUSIVE');
    });

    it('splitEqual switches a CUSTOM expense back to EQUAL', async () => {
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2000, splitStrategy: 'CUSTOM', series: null, lineItems: [] }));
        const res = await PATCH(patchReq({ splitEqual: true, amount: 21 }), { params });
        expect(res.status).toBe(200);
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('EQUAL');
        expect(mockSplitCreateMany.mock.calls[0][0].data.map((s: { amount: number }) => s.amount)).toEqual([1050, 1050]);
    });

    it('itemized lines with a new amount are rescaled, not dumped on one member (G-03)', async () => {
        const receiptItems = [
            { description: 'Pan', quantity: 1, price: 3.39, total: 3.39, assignedTo: 'u1' },
            { description: 'Leche', quantity: 1, price: 3.36, total: 3.36, assignedTo: null },
        ];
        const res = await PATCH(patchReq({ amount: 20, receiptItems }), { params });
        expect(res.status).toBe(200);
        const rows = mockSplitCreateMany.mock.calls[0][0].data as { userId: string; amount: number }[];
        expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(2000);
        expect(rows.find((r) => r.userId === 'u2')!.amount).toBeLessThan(600); // ~498c, not 1493c
        expect(mockExpenseUpdate.mock.calls[0][0].data.splitStrategy).toBe('ITEMIZED');
    });

    it('400 for a malformed body (invalid JSON, wrong types) before anything is written', async () => {
        const raw = await PATCH(new Request('http://localhost/api/expenses/e1', { method: 'PATCH', body: '{nope' }), { params });
        expect(raw.status).toBe(400);
        expect(await raw.json()).toEqual({ error: 'Petición no válida' });
        for (const [body, message] of [
            [{ paidById: null }, 'Quien pagó no es miembro del espacio'],
            [{ description: '  ' }, 'El concepto es obligatorio'],
            [{ recurringInterval: 'daily' }, 'Periodicidad no válida'],
            [{ amount: 1_000_000 }, 'El importe máximo es 999.999,99 €'],
            [{ customSplits: [{ userId: 'u1', amount: 10.5 }] }, 'Los importes del reparto no son válidos'],
            // VARCHAR(191) columns: 400 instead of a Prisma P2000 → 500.
            [{ notes: 'n'.repeat(192) }, 'Las notas no pueden superar 191 caracteres'],
            [{ description: 'd'.repeat(192) }, 'El concepto no puede superar 191 caracteres'],
            [{ receiptUrl: 'r'.repeat(192) }, 'La URL del recibo no puede superar 191 caracteres'],
        ] as const) {
            const res = await PATCH(patchReq(body), { params });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe(message);
        }
        const typed = await PATCH(patchReq({ notes: 42 }), { params });
        expect(typed.status).toBe(400);
        expect((await typed.json()).issues[0].path).toBe('notes');
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
    });

    it('amount null / "" keeps the persisted amount', async () => {
        for (const amount of [null, '']) {
            mockExpenseUpdate.mockClear();
            const res = await PATCH(patchReq({ amount }), { params });
            expect(res.status).toBe(200);
            expect(mockExpenseUpdate.mock.calls[0][0].data.amount).toBe(2000);
        }
    });

    it('error messages are in Spanish', async () => {
        const res = await PATCH(patchReq({ amount: -1 }), { params });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Importe no válido');
    });
});

describe('PATCH/DELETE /api/expenses/[id] — space lock (A3) and guest cage (H3)', () => {
    beforeEach(() => {
        [mockGetSession, mockExpenseFindUnique, mockExpenseUpdate, mockExpenseDelete, mockSplitFindMany, mockGetGroupMembers, mockPostExpenseLedger, mockCoupleFindUnique]
            .forEach((m) => m.mockReset());
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        mockCoupleFindUnique.mockResolvedValue({ status: 'ACTIVE' });
        mockExpenseFindUnique.mockResolvedValue(sharedExpense({ amount: 2000, series: null, lineItems: [], splitStrategy: 'EQUAL' }));
        mockSplitFindMany.mockResolvedValue([{ userId: 'u1', amount: 1000 }, { userId: 'u2', amount: 1000 }]);
        mockExpenseUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'e1', visibility: 'SHARED', coupleId: 'c1', amount: 2000, date: new Date(0), seriesId: null, paidById: 'u1', ...data }));
        mockExpenseDelete.mockResolvedValue({ count: 1 });
    });

    it.each(['SETTLING', 'ARCHIVED'])('PATCH: 409 when the space became %s between the pre-check and the lock', async (status) => {
        // Pre-check sees ACTIVE; the status read under the row lock does not.
        mockCoupleFindUnique.mockResolvedValueOnce({ status: 'ACTIVE' }).mockResolvedValue({ status });
        const res = await PATCH(patchReq({ description: 'Cena' }), { params });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('SPACE_NOT_WRITABLE');
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
    });

    it('DELETE: 409 when the space was archived concurrently (status re-read under the lock)', async () => {
        mockCoupleFindUnique.mockResolvedValueOnce({ status: 'ACTIVE' }).mockResolvedValue({ status: 'ARCHIVED' });
        const res = await DELETE(req(), { params });
        expect(res.status).toBe(409);
        expect(mockExpenseDelete).not.toHaveBeenCalled();
    });

    it('PATCH: 409 MEMBERS_CHANGED when someone left between validation and the lock', async () => {
        // Validation/split computed for u1+u2+u3; under the lock only u1+u2 remain.
        mockGetGroupMembers
            .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])
            .mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        const res = await PATCH(patchReq({ amount: 30 }), { params });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe('MEMBERS_CHANGED');
        expect(mockExpenseUpdate).not.toHaveBeenCalled();
        expect(mockPostExpenseLedger).not.toHaveBeenCalled();
    });

    it('a PERSONAL expense takes no space lock', async () => {
        mockExpenseFindUnique.mockResolvedValue(personalExpense({ amount: 2000, series: null, lineItems: [] }));
        const res = await PATCH(patchReq({ description: 'Libro' }), { params });
        expect(res.status).toBe(200);
        expect(mockCoupleFindUnique).not.toHaveBeenCalled();
    });

    it('a guest cannot touch an expense of another space, nor a personal one', async () => {
        // u2 is a (revalidated) guest member of c1's roster but caged to "other".
        mockGetSession.mockResolvedValue({ userId: 'u2', kind: 'guest', groupId: 'other' });
        expect((await DELETE(req(), { params })).status).toBe(403);
        mockExpenseFindUnique.mockResolvedValue(personalExpense({ ownerId: 'u2' }));
        expect((await DELETE(req(), { params })).status).toBe(403);
        expect(mockExpenseDelete).not.toHaveBeenCalled();
    });

    it('a guest may delete in its own space', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u2', kind: 'guest', groupId: 'c1' });
        expect((await DELETE(req(), { params })).status).toBe(200);
    });
});
