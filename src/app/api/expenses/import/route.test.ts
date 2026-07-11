import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockFindMany = vi.fn();
const mockCreateMany = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
vi.mock('@/lib/category-db', () => ({
    resolveCategoryId: vi.fn().mockResolvedValue('cat-other'),
    // Effective personal set for u1: the 8 system keys are always present.
    getEffectiveCategories: vi.fn().mockResolvedValue([{ key: 'other' }, { key: 'food' }, { key: 'transport' }]),
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        expense: {
            findMany: (...a: unknown[]) => mockFindMany(...a),
            createMany: (...a: unknown[]) => mockCreateMany(...a),
        },
    },
}));

import { POST } from './route';

function req(body: unknown) {
    return new Request('http://localhost/api/expenses/import', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}
const row = (over = {}) => ({ dateISO: '2026-07-09', amountCents: 2492, description: 'Kiwoko', ...over });

describe('POST /api/expenses/import', () => {
    beforeEach(() => {
        [mockGetSession, mockFindMany, mockCreateMany].forEach((m) => m.mockReset());
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockFindMany.mockResolvedValue([]); // nothing previously imported
        mockCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await POST(req({ rows: [row()] }))).status).toBe(401);
    });

    it('400 on empty rows', async () => {
        expect((await POST(req({ rows: [] }))).status).toBe(400);
    });

    it('400 on an invalid date or amount', async () => {
        expect((await POST(req({ rows: [row({ dateISO: '09/07/2026' })] }))).status).toBe(400);
        expect((await POST(req({ rows: [row({ amountCents: 0 })] }))).status).toBe(400);
        expect((await POST(req({ rows: [row({ description: '  ' })] }))).status).toBe(400);
    });

    it('creates PERSONAL expenses with date + fingerprint', async () => {
        const res = await POST(req({ rows: [row(), row({ description: 'Alcampo', amountCents: 5000 })] }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ created: 2, skipped: 0 });
        const data = mockCreateMany.mock.calls[0][0].data;
        expect(data).toHaveLength(2);
        expect(data[0].visibility).toBe('PERSONAL');
        expect(data[0].ownerId).toBe('u1');
        expect(data[0].coupleId).toBeNull();
        expect(data[0].amount).toBe(2492);
        expect(data[0].importFingerprint).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
        expect(data[0].date).toBeInstanceOf(Date);
    });

    it('400s on an unknown defaultCategory (no silent fallback to other)', async () => {
        const res = await POST(req({ rows: [row()], defaultCategory: 'nope' }));
        expect(res.status).toBe(400);
        expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it('400s on an unknown per-row category', async () => {
        const res = await POST(req({ rows: [row({ category: 'ghost' })] }));
        expect(res.status).toBe(400);
        expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it('accepts a valid defaultCategory from the effective set', async () => {
        const res = await POST(req({ rows: [row()], defaultCategory: 'transport' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ created: 1, skipped: 0 });
    });

    it('dedups repeats WITHIN the batch (same content = one insert)', async () => {
        const res = await POST(req({ rows: [row(), row()] }));
        expect(await res.json()).toEqual({ created: 1, skipped: 1 });
        expect(mockCreateMany.mock.calls[0][0].data).toHaveLength(1);
    });

    it('skips rows whose fingerprint is ALREADY stored (re-import is a no-op)', async () => {
        // Echo back the queried fingerprints as already-existing.
        mockFindMany.mockImplementation(async ({ where }: { where: { importFingerprint: { in: string[] } } }) =>
            where.importFingerprint.in.map((fp) => ({ importFingerprint: fp })));
        const res = await POST(req({ rows: [row(), row({ description: 'Alcampo' })] }));
        expect(await res.json()).toEqual({ created: 0, skipped: 2 });
        expect(mockCreateMany).not.toHaveBeenCalled();
    });
});
