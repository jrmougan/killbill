import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockGetActiveGroup = vi.fn();
const mockGetGroupMembers = vi.fn();
const mockResolveCategoryId = vi.fn();
const mockExpenseCreate = vi.fn();
const mockSeriesCreate = vi.fn();
const mockSeriesUpdate = vi.fn();
const mockPostExpenseLedger = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/authz', () => ({
    getSessionCtx: () => mockGetSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock('@/lib/membership', () => ({
    getActiveGroup: (...a: unknown[]) => mockGetActiveGroup(...a),
    getGroupMembers: (...a: unknown[]) => mockGetGroupMembers(...a),
}));
vi.mock('@/lib/category-db', () => ({ resolveCategoryId: (...a: unknown[]) => mockResolveCategoryId(...a) }));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: (...a: unknown[]) => mockPostExpenseLedger(...a) }));
const tx = {
    expense: { create: (...a: unknown[]) => mockExpenseCreate(...a) },
    recurringSeries: { create: (...a: unknown[]) => mockSeriesCreate(...a), update: (...a: unknown[]) => mockSeriesUpdate(...a) },
};
vi.mock('@/lib/expense-tx', () => ({ runLedgerTransaction: (fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } } }));

import { POST } from './route';

function post(body: unknown) {
    return POST(new Request('http://localhost/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }));
}

const base = { amount: 12.5, description: 'Súper', category: 'food' };

describe('POST /api/expenses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: 'u1' });
        mockRequireSpaceAccess.mockResolvedValue({ ok: true });
        mockGetActiveGroup.mockResolvedValue('active');
        mockGetGroupMembers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
        mockResolveCategoryId.mockResolvedValue('cat-food');
        mockUserFindUnique.mockResolvedValue({ id: 'u1' });
        mockSeriesCreate.mockResolvedValue({ id: 's1' });
        mockExpenseCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
            id: 'e1', visibility: data.visibility, coupleId: data.coupleId, amount: data.amount, paidById: data.paidById,
            date: data.date ?? new Date(), splits: ((data.splits as { create?: unknown[] } | undefined)?.create ?? []),
        }));
    });

    it('401 without a session', async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await post(base)).status).toBe(401);
    });

    describe('destination space (G-02)', () => {
        it('writes into the EXPLICIT groupId, authorized against that space — not the active cookie', async () => {
            const res = await post({ ...base, groupId: 'chosen' });
            expect(res.status).toBe(200);
            expect(mockRequireSpaceAccess).toHaveBeenCalledWith({ userId: 'u1' }, 'chosen', { allowGuest: true });
            expect(mockGetActiveGroup).not.toHaveBeenCalled();
            expect(mockExpenseCreate.mock.calls[0][0].data.coupleId).toBe('chosen');
            expect(mockGetGroupMembers).toHaveBeenCalledWith('chosen');
            expect(await res.json()).toMatchObject({ expenseId: 'e1', groupId: 'chosen' });
        });

        it('falls back to the active space when groupId is absent (MCP / old clients)', async () => {
            const res = await post(base);
            expect(res.status).toBe(200);
            expect(mockRequireSpaceAccess).toHaveBeenCalledWith({ userId: 'u1' }, 'active', { allowGuest: true });
            expect(mockExpenseCreate.mock.calls[0][0].data.coupleId).toBe('active');
        });

        it('403 when the caller is not a member of the requested space', async () => {
            mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: 'No perteneces a este espacio' });
            const res = await post({ ...base, groupId: 'foreign' });
            expect(res.status).toBe(403);
            expect(mockExpenseCreate).not.toHaveBeenCalled();
        });

        it('409 when the requested space is not writable (SETTLING/ARCHIVED)', async () => {
            mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 409, error: 'Este espacio está archivado (solo lectura)', code: 'SPACE_NOT_WRITABLE' });
            const res = await post({ ...base, groupId: 'archived' });
            expect(res.status).toBe(409);
            expect(await res.json()).toEqual({ error: 'Este espacio está archivado (solo lectura)', code: 'SPACE_NOT_WRITABLE' });
        });

        it('400 for a malformed groupId', async () => {
            expect((await post({ ...base, groupId: 42 })).status).toBe(400);
            expect((await post({ ...base, groupId: '' })).status).toBe(400);
        });

        it('personal expenses ignore spaces entirely', async () => {
            const res = await post({ ...base, isPersonal: true, groupId: 'whatever' });
            expect(res.status).toBe(200);
            expect(mockRequireSpaceAccess).not.toHaveBeenCalled();
            const data = mockExpenseCreate.mock.calls[0][0].data;
            expect(data.visibility).toBe('PERSONAL');
            expect(data.coupleId).toBeNull();
            expect(mockPostExpenseLedger).not.toHaveBeenCalled();
        });

        it('guests cannot create personal expenses', async () => {
            mockGetSessionCtx.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId: 'trip' });
            expect((await post({ ...base, isPersonal: true })).status).toBe(403);
        });
    });

    describe('dates (T-03)', () => {
        it.each(['2026-02-31', '0001-01-01', '9999-12-31', '2099-01-01', 'ayer'])('400 for %s', async (date) => {
            const res = await post({ ...base, date });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/fecha/i);
            expect(mockExpenseCreate).not.toHaveBeenCalled();
        });

        it('stores a valid date at 12:00 UTC', async () => {
            await post({ ...base, date: '2026-09-15' });
            expect(mockExpenseCreate.mock.calls[0][0].data.date).toEqual(new Date('2026-09-15T12:00:00.000Z'));
        });
    });

    it('recurring series runs next from the expense date, not today (G-12)', async () => {
        const res = await post({ ...base, date: '2026-09-15', isRecurring: true, recurringInterval: 'monthly' });
        expect(res.status).toBe(200);
        const next: Date = mockSeriesCreate.mock.calls[0][0].data.nextRunDate;
        // The first monthly occurrence after 15/09 that is still in the future.
        expect(next.getUTCDate()).toBe(15);
        expect(next.getTime()).toBeGreaterThan(Date.now());
        expect(next.getTime()).toBeLessThan(Date.now() + 32 * 86_400_000);
    });

    it('400 for an unknown recurring interval', async () => {
        expect((await post({ ...base, isRecurring: true, recurringInterval: 'daily' })).status).toBe(400);
    });

    describe('validation messages are Spanish (G-20)', () => {
        it.each([
            [{ ...base, category: 'nope' }, 'Categoría no válida', () => mockResolveCategoryId.mockResolvedValue(null)],
            [{ ...base, amount: 0 }, 'Importe no válido', () => {}],
            [{ ...base, amount: 1_000_000 }, 'El importe máximo es 999.999,99 €', () => {}],
            [{ ...base, description: '  ' }, 'El concepto es obligatorio', () => {}],
            [{ ...base, customSplits: [{ userId: 'u1', amount: 100 }, { userId: 'u2', amount: 100 }] }, 'El reparto no suma el importe total', () => {}],
            [{ ...base, beneficiaryId: 'stranger' }, 'La persona elegida no es miembro del espacio', () => {}],
            [{ ...base, paidById: 'stranger' }, 'Quien pagó no es miembro del espacio', () => {}],
        ] as const)('%#', async (body, message, setup) => {
            setup();
            const res = await post(body);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe(message);
        });
    });

    it('itemized receipt lines produce an ITEMIZED split (not CUSTOM) that sums to the amount (G-03/G-16)', async () => {
        const receiptData = [
            { description: 'Pan', quantity: 1, price: 3.39, total: 3.39, assignedTo: 'u1' },
            { description: 'Leche', quantity: 1, price: 3.36, total: 3.36, assignedTo: null },
        ];
        const res = await post({ ...base, amount: 6.75, receiptData });
        expect(res.status).toBe(200);
        const data = mockExpenseCreate.mock.calls[0][0].data;
        expect(data.splitStrategy).toBe('ITEMIZED');
        expect(data.splits.create).toEqual([{ userId: 'u1', amount: 507 }, { userId: 'u2', amount: 168 }]);
    });

    it('posts the ledger for a shared expense inside the transaction', async () => {
        await post({ ...base, groupId: 'chosen' });
        expect(mockPostExpenseLedger).toHaveBeenCalledOnce();
        expect(mockPostExpenseLedger.mock.calls[0][1]).toMatchObject({ groupId: 'chosen', amount: 1250 });
    });
});
