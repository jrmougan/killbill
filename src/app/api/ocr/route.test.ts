// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionCtx } from '@/lib/authz';
import { rateLimit } from '@/lib/rate-limit';
import { analyzeReceiptImage, ReceiptAIError } from '@/lib/receipt-ocr-ai';
import { POST } from './route';

vi.mock('@/lib/authz', () => ({ getSessionCtx: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(), getClientIp: () => 'ip' }));
vi.mock('@/lib/receipt-ocr-ai', () => ({
    analyzeReceiptImage: vi.fn(),
    ReceiptAIError: class ReceiptAIError extends Error {},
}));

const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex');

function ocr() {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'r.png');
    return POST(new Request('http://localhost/api/ocr', { method: 'POST', body: form }));
}

beforeEach(() => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    vi.mocked(analyzeReceiptImage).mockResolvedValue({ store: 'S', category: 'shopping', items: [], total: 0 });
});

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe('/api/ocr session handling', () => {
    it('returns 401 when getSessionCtx rejects the session (e.g. revoked guest)', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue(null);
        expect((await ocr()).status).toBe(401);
        expect(analyzeReceiptImage).not.toHaveBeenCalled();
    });

    it('lets a regular member scan without the per-space guest cap', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'u1', isAdmin: false, kind: undefined });
        expect((await ocr()).status).toBe(200);
        expect(vi.mocked(rateLimit).mock.calls.map(c => c[0])).toEqual(['ocr:user:u1']);
    });

    it('applies the per-space daily cap to live guests when ephemeral spaces are on', async () => {
        vi.stubEnv('EPHEMERAL_SPACES_ENABLED', 'true');
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'g1', isAdmin: false, kind: 'guest', groupId: 'sp1' });
        expect((await ocr()).status).toBe(200);
        expect(vi.mocked(rateLimit).mock.calls.map(c => c[0])).toEqual(['ocr:user:g1', 'ocr:space:sp1']);
    });

    it('429 with Retry-After: per-user limit, then the guest per-space daily cap with its own message', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'u1', isAdmin: false, kind: undefined });
        vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, retryAfterSeconds: 30 });
        const user = await ocr();
        expect(user.status).toBe(429);
        expect(user.headers.get('Retry-After')).toBe('30');
        expect(await user.json()).toEqual({ error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' });

        vi.stubEnv('EPHEMERAL_SPACES_ENABLED', 'true');
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'g1', isAdmin: false, kind: 'guest', groupId: 'sp1' });
        vi.mocked(rateLimit)
            .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0 })
            .mockReturnValueOnce({ allowed: false, retryAfterSeconds: 999 });
        const guest = await ocr();
        expect(guest.status).toBe(429);
        expect(guest.headers.get('Retry-After')).toBe('999');
        expect(await guest.json()).toEqual({ error: 'Se alcanzó el límite diario de escaneos de este espacio.' });
        expect(analyzeReceiptImage).not.toHaveBeenCalled();
    });

    it('maps a provider failure (ReceiptAIError) to 502 with its message', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'u1', isAdmin: false, kind: undefined });
        vi.mocked(analyzeReceiptImage).mockRejectedValue(new ReceiptAIError('Proveedores caídos'));
        const res = await ocr();
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: 'Proveedores caídos' });
    });

    it('400 for a non-multipart body (it used to be a 500)', async () => {
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'u1', isAdmin: false, kind: undefined });
        const res = await POST(new Request('http://localhost/api/ocr', {
            method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
        }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Petición no válida' });
        expect(analyzeReceiptImage).not.toHaveBeenCalled();
    });

    it('rejects guests while ephemeral spaces are disabled', async () => {
        vi.stubEnv('EPHEMERAL_SPACES_ENABLED', 'false');
        vi.mocked(getSessionCtx).mockResolvedValue({ userId: 'g1', isAdmin: false, kind: 'guest', groupId: 'sp1' });
        expect((await ocr()).status).toBe(403);
        expect(analyzeReceiptImage).not.toHaveBeenCalled();
    });
});
