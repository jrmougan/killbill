import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryRaw = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: { $queryRaw: (...a: unknown[]) => mockQueryRaw(...a) },
}));

import { GET } from './route';

describe('GET /api/health', () => {
    beforeEach(() => {
        mockQueryRaw.mockReset();
    });

    it('devuelve 200 {status:"ok"} sin caché cuando la BD responde', async () => {
        mockQueryRaw.mockResolvedValue([{ 1: 1 }]);
        const res = await GET();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('devuelve 503 sin filtrar el error cuando la BD falla', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockQueryRaw.mockRejectedValue(new Error('ECONNREFUSED secreto-interno'));
        const res = await GET();
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body).toEqual({ status: 'error' });
        expect(JSON.stringify(body)).not.toContain('secreto');
        expect(res.headers.get('cache-control')).toBe('no-store');
        spy.mockRestore();
    });
});
