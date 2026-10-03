// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'node:path';
import { getSession } from '@/lib/auth';
import { POST } from './route';

vi.mock('fs/promises', async importOriginal => ({
    ...await importOriginal<typeof import('fs/promises')>(),
    mkdir: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('crypto', async importOriginal => ({
    ...await importOriginal<typeof import('crypto')>(),
    randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
}));

function upload(buffer: Buffer, type = 'image/png') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type }), 'receipt.png');
    return POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
}

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });

describe('receipt upload storage', () => {
    it('creates the storage directory before writing the validated image', async () => {
        vi.mocked(getSession).mockResolvedValue({ userId: 'user-a' });
        const bytes = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const response = await upload(bytes);
        expect(response.status).toBe(200);
        const directory = join(process.cwd(), 'public', 'uploads');
        expect(mkdir).toHaveBeenCalledWith(directory, { recursive: true });
        expect(writeFile).toHaveBeenCalledWith(join(directory, '550e8400-e29b-41d4-a716-446655440000.png'), bytes);
        expect(vi.mocked(mkdir).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(writeFile).mock.invocationCallOrder[0]);
        expect(await response.json()).toEqual({ success: true, url: '/uploads/550e8400-e29b-41d4-a716-446655440000.png' });
    });

    it('preserves authentication and image validation before storage writes', async () => {
        vi.mocked(getSession).mockResolvedValue(null);
        expect((await upload(Buffer.from('invalid image'))).status).toBe(401);
        vi.mocked(getSession).mockResolvedValue({ userId: 'user-a' });
        expect((await upload(Buffer.from('invalid image'))).status).toBe(400);
        expect(mkdir).not.toHaveBeenCalled();
        expect(writeFile).not.toHaveBeenCalled();
    });
});
