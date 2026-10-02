// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { GET } from './route';

vi.mock('node:fs/promises', async importOriginal => ({
    ...await importOriginal<typeof import('node:fs/promises')>(),
    readFile: vi.fn(),
}));
const id = '550e8400-e29b-41d4-a716-446655440000';

function get(filename: string) {
    return GET(new Request('http://localhost/uploads/receipt'), { params: Promise.resolve({ filename }) });
}

afterEach(() => { vi.resetAllMocks(); });

describe('dynamic uploaded receipt reader', () => {
    it.each([['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']])
        ('serves a newly uploaded %s with exact bytes and safe headers', async (extension, contentType) => {
            const bytes = Buffer.from([0, 1, 255, 128]);
            vi.mocked(readFile).mockResolvedValue(bytes);
            const response = await get(`${id}.${extension}`);
            expect(response.status).toBe(200);
            expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
            expect(response.headers.get('Content-Type')).toBe(contentType);
            expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(readFile).toHaveBeenCalledWith(join(process.cwd(), 'public', 'uploads', `${id}.${extension}`));
        });

    it.each(['../secret.png', `%2e%2e%2f${id}.png`, `${id}.png/..`, `${id}.svg`, `${id}.gif`, 'receipt.png', `../${id}.png`, `${id}.png\0`, `${id}.png?token=x`])
        ('rejects invalid basename %s before reading disk', async filename => {
            expect((await get(filename)).status).toBe(404);
            expect(readFile).not.toHaveBeenCalled();
        });

    it('returns 404 for a nonexistent receipt', async () => {
        vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('Not found'), { code: 'ENOENT' }));
        expect((await get(`${id}.png`)).status).toBe(404);
    });

    it('returns 500 for a storage failure', async () => {
        vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            expect((await get(`${id}.png`)).status).toBe(500);
        } finally {
            log.mockRestore();
        }
    });
});
