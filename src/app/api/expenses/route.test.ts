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
    MAX_GROUP_MEMBERS: 20,
}));
vi.mock('@/lib/category-db', () => ({ resolveCategoryId: (...a: unknown[]) => mockResolveCategoryId(...a) }));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: (...a: unknown[]) => mockPostExpenseLedger(...a) }));
// Status the space has when the lock is taken, and the ACTIVE roster re-read
// inside the transaction (A3). Default: unchanged since validation.
const mockLockedStatus = vi.fn(() => 'ACTIVE');
const mockLockedRoster = vi.fn((): string[] | null => null);
const mockWithSpaceLock = vi.fn();
const tx = {
    expense: { create: (...a: unknown[]) => mockExpenseCreate(...a) },
    recurringSeries: { create: (...a: unknown[]) => mockSeriesCreate(...a), update: (...a: unknown[]) => mockSeriesUpdate(...a) },
    membership: {
        findMany: async () => (mockLockedRoster() ?? ((await mockGetGroupMembers()) as { id: string }[]).map((m) => m.id))
            .map((userId) => ({ userId })),
    },
};
vi.mock('@/lib/expense-tx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/expense-tx')>();
    return {
        ...actual,
        runLedgerTransaction: (fn: (t: unknown) => unknown) => fn(tx),
        // Emulates the space row lock: the callback gets the status read under it.
        withSpaceLock: (groupId: string, fn: (t: unknown, status: string) => unknown) => {
            mockWithSpaceLock(groupId);
            return fn(tx, mockLockedStatus());
        },
    };
});
const mockExpenseFindMany = vi.fn();
vi.mock('@/lib/db', () => ({
    prisma: {
        user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
        expense: { findMany: (...a: unknown[]) => mockExpenseFindMany(...a) },
    },
}));

import { GET, POST } from './route';

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
        mockLockedStatus.mockReturnValue('ACTIVE');
        mockLockedRoster.mockReturnValue(null);
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

    describe('space lock (A3)', () => {
        it('a SHARED expense is created under the space lock of its destination', async () => {
            const res = await post({ ...base, groupId: 'chosen' });
            expect(res.status).toBe(200);
            expect(mockWithSpaceLock).toHaveBeenCalledWith('chosen');
        });

        it('a PERSONAL expense takes no space lock', async () => {
            await post({ ...base, isPersonal: true });
            expect(mockWithSpaceLock).not.toHaveBeenCalled();
        });

        it.each([
            ['SETTLING', 'Este espacio se está liquidando: no se pueden crear gastos nuevos'],
            ['ARCHIVED', 'Este espacio está archivado (solo lectura)'],
        ])('409 SPACE_NOT_WRITABLE when the space became %s before the lock (status re-read under it)', async (status, error) => {
            // requireSpaceAccess saw ACTIVE; the space was closed concurrently.
            mockLockedStatus.mockReturnValue(status);
            const res = await post({ ...base, groupId: 'chosen' });
            expect(res.status).toBe(409);
            expect(await res.json()).toEqual({ error, code: 'SPACE_NOT_WRITABLE' });
            expect(mockExpenseCreate).not.toHaveBeenCalled();
            expect(mockPostExpenseLedger).not.toHaveBeenCalled();
        });

        it('409 MEMBERS_CHANGED when the roster changed between validation and the lock', async () => {
            // u2 was expelled concurrently: the EQUAL split computed for u1+u2 is stale.
            mockLockedRoster.mockReturnValue(['u1']);
            const res = await post({ ...base, groupId: 'chosen' });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe('MEMBERS_CHANGED');
            expect(mockExpenseCreate).not.toHaveBeenCalled();
        });
    });
});

/**
 * In-memory stand-in for `prisma.expense.findMany` with keyset semantics: rows
 * are ordered by the requested `orderBy` keys only — rows that tie on every key
 * come back in a RANDOM order on each call, like an SQL engine is free to do —
 * and `cursor` + `skip: 1` starts right after the cursor row of that ordering.
 */
type Row = { id: string; date: Date; paidBy: { name: string } };
function fakeFindMany(rows: Row[]) {
    return async (args: { orderBy: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]; take: number; cursor?: { id: string }; skip?: number }) => {
        const keys = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).map((o) => Object.entries(o)[0]);
        const cmp = (a: Row, b: Row) => {
            for (const [k, dir] of keys) {
                const va = (a as unknown as Record<string, Date | string>)[k];
                const vb = (b as unknown as Record<string, Date | string>)[k];
                const c = va < vb ? -1 : va > vb ? 1 : 0;
                if (c !== 0) return dir === 'desc' ? -c : c;
            }
            return 0;
        };
        const sorted = rows
            .map((r) => ({ r, tie: Math.random() }))
            .sort((x, y) => cmp(x.r, y.r) || x.tie - y.tie)
            .map((x) => x.r);
        let start = 0;
        if (args.cursor) start = sorted.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0);
        return sorted.slice(start, start + args.take);
    };
}

describe('GET /api/expenses — keyset pagination (M3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: 'u1' });
        mockGetActiveGroup.mockResolvedValue('active');
    });

    async function page(cursor?: string) {
        const url = `http://localhost/api/expenses?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        return (await GET(new Request(url))).json() as Promise<{ expenses: { id: string }[]; nextCursor: string | null }>;
    }

    it('orders by date DESC then id DESC (tie-breaker)', async () => {
        mockExpenseFindMany.mockResolvedValue([]);
        await page();
        expect(mockExpenseFindMany.mock.calls[0][0].orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
        expect(mockExpenseFindMany.mock.calls[0][0].where).toEqual({ coupleId: 'active', visibility: 'SHARED' });
    });

    it('walks 10 expenses sharing the same date exactly once each, in a stable order', async () => {
        const sameDay = new Date('2026-09-15T12:00:00.000Z');
        const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: `e${String(i).padStart(2, '0')}`, date: sameDay, paidBy: { name: 'A' } }));
        mockExpenseFindMany.mockImplementation(fakeFindMany(rows));

        for (let run = 0; run < 5; run++) {
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const res = await page(cursor);
                seen.push(...res.expenses.map((e) => e.id));
                cursor = res.nextCursor ?? undefined;
            } while (cursor);
            expect(seen).toEqual(rows.map((r) => r.id).sort().reverse());
        }
    });

    it('a guest session lists only the space it is caged to and has no personal scope', async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId: 'trip' });
        mockExpenseFindMany.mockResolvedValue([]);
        await page();
        expect(mockExpenseFindMany.mock.calls[0][0].where).toEqual({ coupleId: 'trip', visibility: 'SHARED' });
        expect(mockGetActiveGroup).not.toHaveBeenCalled();

        const res = await GET(new Request('http://localhost/api/expenses?scope=personal'));
        expect(await res.json()).toEqual({ expenses: [], nextCursor: null });
        expect(mockExpenseFindMany).toHaveBeenCalledOnce();
    });

    it('401 without a (revalidated) session', async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await GET(new Request('http://localhost/api/expenses'))).status).toBe(401);
    });
});
