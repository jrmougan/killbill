import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSessionCtx = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockTagFindUnique = vi.fn();
const mockExpenseTagFindFirst = vi.fn();
const mockExpenseTagCreate = vi.fn();
const mockExpenseTagDeleteMany = vi.fn();

vi.mock('@/lib/authz', () => ({ getSessionCtx: () => mockGetSessionCtx(), requireSpaceAccess: vi.fn() }));
vi.mock('@/lib/membership', () => ({ getGroupMembers: async () => [{ id: 'u1' }, { id: 'u2' }] }));
vi.mock('@/lib/db', () => ({
    prisma: {
        expense: { findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a) },
        tag: { findUnique: (...a: unknown[]) => mockTagFindUnique(...a) },
        expenseTag: {
            findFirst: (...a: unknown[]) => mockExpenseTagFindFirst(...a),
            create: (...a: unknown[]) => mockExpenseTagCreate(...a),
            deleteMany: (...a: unknown[]) => mockExpenseTagDeleteMany(...a),
        },
    },
}));

import { POST, DELETE } from './route';

const params = Promise.resolve({ id: 'e1' });
const call = (fn: typeof POST, body: string | undefined) =>
    fn(new Request('http://localhost/api/expenses/e1/tags', { method: 'POST', ...(body !== undefined ? { body } : {}) }), { params });

describe('/api/expenses/[id]/tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue({ id: 'e1', visibility: 'SHARED', coupleId: 'c1', ownerId: 'u1' });
        mockTagFindUnique.mockResolvedValue({ id: 't1', coupleId: 'c1', ownerId: null });
        mockExpenseTagFindFirst.mockResolvedValue(null);
        mockExpenseTagCreate.mockResolvedValue({});
        mockExpenseTagDeleteMany.mockResolvedValue({ count: 1 });
    });

    it('401 / 404 / 403 come before any body validation', async () => {
        mockGetSessionCtx.mockResolvedValueOnce(null);
        expect((await call(POST, '{')).status).toBe(401);
        mockExpenseFindUnique.mockResolvedValueOnce(null);
        expect((await call(POST, '{')).status).toBe(404);
        mockExpenseFindUnique.mockResolvedValueOnce({ id: 'e1', visibility: 'SHARED', coupleId: 'other', ownerId: 'u1' });
        mockGetSessionCtx.mockResolvedValueOnce({ userId: 'stranger' });
        const denied = await call(DELETE, '{');
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: 'No autorizado' });
    });

    it('POST tags (201), idempotent (200), and scope-checks the tag', async () => {
        expect((await call(POST, JSON.stringify({ tagId: 't1' }))).status).toBe(201);
        mockExpenseTagFindFirst.mockResolvedValueOnce({ expenseId: 'e1' });
        expect((await call(POST, JSON.stringify({ tagId: 't1' }))).status).toBe(200);
        mockTagFindUnique.mockResolvedValueOnce({ id: 't2', coupleId: 'other', ownerId: null });
        const foreign = await call(POST, JSON.stringify({ tagId: 't2' }));
        expect(foreign.status).toBe(404);
        expect(await foreign.json()).toEqual({ error: 'Etiqueta no encontrada en este espacio' });
    });

    it.each([[POST], [DELETE]])('400 "Falta la etiqueta" without a valid tagId (%#)', async (fn) => {
        for (const body of [undefined, 'null', '{}', JSON.stringify({ tagId: '' }), JSON.stringify({ tagId: 5 })]) {
            const res = await call(fn, body);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe('Falta la etiqueta');
        }
        expect(mockExpenseTagCreate).not.toHaveBeenCalled();
        expect(mockExpenseTagDeleteMany).not.toHaveBeenCalled();
    });

    it('DELETE: invalid JSON is a 400 (used to crash with a 500); missing link is a 404', async () => {
        const bad = await call(DELETE, '{nope');
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: 'Petición no válida' });
        expect((await call(DELETE, JSON.stringify({ tagId: 't1' }))).status).toBe(200);
        mockExpenseTagDeleteMany.mockResolvedValueOnce({ count: 0 });
        const missing = await call(DELETE, JSON.stringify({ tagId: 't1' }));
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: 'El gasto no tiene esa etiqueta' });
    });
});
