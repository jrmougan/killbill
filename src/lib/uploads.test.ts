import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { legacyUploadDir, uploadDir, uploadNameFromUrl, uploadPathCandidates } from './uploads';

afterEach(() => vi.unstubAllEnvs());

describe('upload storage paths', () => {
    it('defaults to <cwd>/uploads, outside public/', () => {
        vi.stubEnv('UPLOAD_DIR', '');
        expect(uploadDir()).toBe(join(process.cwd(), 'uploads'));
        expect(uploadDir()).not.toContain(join('public', 'uploads'));
    });

    it('honours UPLOAD_DIR (absolute or relative to cwd)', () => {
        vi.stubEnv('UPLOAD_DIR', '/app/uploads');
        expect(uploadDir()).toBe('/app/uploads');
        vi.stubEnv('UPLOAD_DIR', 'data/up');
        expect(uploadDir()).toBe(join(process.cwd(), 'data', 'up'));
    });

    it('lists the current dir first, then the legacy public/uploads; strips traversal', () => {
        vi.stubEnv('UPLOAD_DIR', '/app/uploads');
        expect(uploadPathCandidates('../../etc/passwd')).toEqual([
            join('/app/uploads', 'passwd'),
            join(legacyUploadDir(), 'passwd'),
        ]);
    });

    it('extracts the basename of app-hosted upload URLs only', () => {
        expect(uploadNameFromUrl('/uploads/a.png')).toBe('a.png');
        expect(uploadNameFromUrl('/uploads/../../x.png')).toBeNull();
        expect(uploadNameFromUrl('/uploads/..')).toBeNull();
        expect(uploadNameFromUrl('https://evil/uploads/a.png')).toBeNull();
        expect(uploadNameFromUrl('/uploads/')).toBeNull();
        expect(uploadNameFromUrl(null)).toBeNull();
    });
});
