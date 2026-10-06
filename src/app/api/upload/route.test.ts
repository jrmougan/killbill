// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'node:path';
import { getSessionCtx } from '@/lib/authz';
import { rateLimit } from '@/lib/rate-limit';
import { POST } from './route';

vi.mock('fs/promises', async importOriginal => ({
    ...await importOriginal<typeof import('fs/promises')>(),
    mkdir: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('@/lib/authz', () => ({ getSessionCtx: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn() }));
vi.mock('crypto', async importOriginal => ({
    ...await importOriginal<typeof import('crypto')>(),
    randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
}));

const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
const GIF = Buffer.from('474946383961010001000000', 'hex');
const user = { userId: 'user-a', isAdmin: false, kind: undefined };

function upload(buffer: Buffer, type = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type }), 'receipt.png');
    return POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
}

beforeEach(() => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('receipt upload storage', () => {
    it('creates the storage directory before writing the validated image', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue(user);
        const log = vi.spyOn(console, 'log');
        const response = await upload(PNG);
        expect(response.status).toBe(200);
        const directory = join(process.cwd(), 'public', 'uploads');
        expect(mkdir).toHaveBeenCalledWith(directory, { recursive: true });
        expect(writeFile).toHaveBeenCalledWith(join(directory, '550e8400-e29b-41d4-a716-446655440000.png'), PNG);
        expect(vi.mocked(mkdir).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(writeFile).mock.invocationCallOrder[0]);
        expect(await response.json()).toEqual({ success: true, url: '/uploads/550e8400-e29b-41d4-a716-446655440000.png' });
        // The storage path is never logged.
        expect(log).not.toHaveBeenCalled();
    });

    it('preserves authentication and image validation before storage writes', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue(null);
        expect((await upload(Buffer.from('invalid image'))).status).toBe(401);
        vi.mocked(getSessionCtx).mockResolvedValue(user);
        expect((await upload(Buffer.from('invalid image'))).status).toBe(400);
        expect(mkdir).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rejects GIF bytes even when disguised as an allowed MIME type', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue(user);
        expect((await upload(GIF, 'image/png')).status).toBe(400);
        expect((await upload(GIF, 'image/gif')).status).toBe(400);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rate-limits per user and answers 429 with Retry-After', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue(user);
        vi.mocked(rateLimit).mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
        const response = await upload(PNG);
        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('42');
        expect(rateLimit).toHaveBeenCalledWith('upload:user:user-a', expect.any(Number), expect.any(Number));
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('rejects guest sessions while ephemeral spaces are disabled', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'guest-1', isAdmin: false, kind: 'guest', groupId: 'g1' });
        vi.stubEnv('EPHEMERAL_SPACES_ENABLED', 'false');
        expect((await upload(PNG)).status).toBe(403);
        vi.stubEnv('EPHEMERAL_SPACES_ENABLED', 'true');
        expect((await upload(PNG)).status).toBe(200);
    });
});
