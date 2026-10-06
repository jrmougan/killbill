import { basename, join, resolve } from 'node:path';

/**
 * Where uploaded receipts/avatars live on disk.
 *
 * NEVER under `public/`: Next indexes `public/` at server boot and serves those
 * files statically BEFORE any route handler, so a file there would bypass the
 * session check of `src/app/uploads/[filename]/route.ts` after the next restart.
 *
 * `UPLOAD_DIR` (absolute, or relative to the cwd) overrides the default
 * `<cwd>/uploads` (`/app/uploads` in the Docker image, a persistent volume).
 */
export function uploadDir(): string {
    const configured = process.env.UPLOAD_DIR?.trim();
    return configured
        ? resolve(/*turbopackIgnore: true*/ process.cwd(), configured)
        : join(/*turbopackIgnore: true*/ process.cwd(), 'uploads');
}

/**
 * Pre-UPLOAD_DIR storage (`public/uploads`). Read (and purged) only for backward
 * compatibility until existing files are moved to uploadDir() — see README.
 */
export function legacyUploadDir(): string {
    return join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'uploads');
}

/** Absolute path where an upload named `filename` is written (basename only). */
export function uploadFilePath(filename: string): string {
    return join(/*turbopackIgnore: true*/ uploadDir(), basename(filename));
}

/**
 * Candidate absolute paths for an uploaded basename, current dir first. The
 * caller must have validated `filename`; basename() is a second guard against
 * path traversal.
 */
export function uploadPathCandidates(filename: string): string[] {
    const name = basename(filename);
    return [uploadFilePath(name), join(/*turbopackIgnore: true*/ legacyUploadDir(), name)];
}

/**
 * Single-segment name of an app-hosted upload URL (`/uploads/<name>`), or null
 * for an external URL / empty / nested / traversal-looking value.
 */
export function uploadNameFromUrl(url: string | null | undefined): string | null {
    if (!url || !url.startsWith('/uploads/')) return null;
    const name = url.slice('/uploads/'.length);
    if (!/^[^/\\]+$/.test(name) || name === '.' || name === '..') return null;
    return name;
}
