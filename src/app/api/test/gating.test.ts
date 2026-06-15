import { describe, it, expect, vi, afterEach } from 'vitest';

// The route modules import the Prisma singleton; mock it so importing them does
// not require a real DB connection. The gating check returns 404 before any
// query, so the mock is never actually used on this path.
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { POST as seedPOST } from './seed/route';
import { POST as resetPOST } from './reset/route';

describe('test-only routes are gated by TEST_ROUTES_ENABLED', () => {
    const original = process.env.TEST_ROUTES_ENABLED;
    afterEach(() => {
        process.env.TEST_ROUTES_ENABLED = original;
    });

    it('POST /api/test/seed returns 404 when the flag is unset', async () => {
        process.env.TEST_ROUTES_ENABLED = '';
        const res = await seedPOST(new Request('http://localhost/api/test/seed', { method: 'POST' }));
        expect(res.status).toBe(404);
    });

    it('POST /api/test/reset returns 404 when the flag is not exactly "true"', async () => {
        process.env.TEST_ROUTES_ENABLED = 'false';
        const res = await resetPOST();
        expect(res.status).toBe(404);
    });
});
