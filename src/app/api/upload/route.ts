import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { uploadDir, uploadFilePath } from '@/lib/uploads';
import { randomUUID } from 'crypto';
import { ephemeralSpacesEnabled } from '@/lib/flags';
import { isAllowedImage, MAX_IMAGE_BYTES as MAX_SIZE_BYTES } from '@/lib/receipt-image';
import { HttpError, badRequest, enforceRateLimit, forbidden, route } from '@/lib/http';
import { readFormFile } from '@/lib/form-file';

// Whitelist of accepted content types mapped to their canonical extension.
// The extension is derived solely from this map so the stored filename can
// never be influenced by attacker-controlled input. Keep in sync with
// ALLOWED_IMAGE_TYPES / isAllowedImage in receipt-image.ts.
const ALLOWED_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

/** Per-user upload budget: 30 receipts per 10 minutes. */
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

// getSessionCtx (in route()) revalidates guest sessions against the DB (revoked /
// archived → null → 401) instead of trusting the JWT claim.
export const POST = route(
    { auth: 'user-or-guest', errorMessage: 'No se pudo subir el archivo', logLabel: 'Error uploading file:' },
    async ({ req, ctx }) => {
        if (ctx.kind === 'guest' && !ephemeralSpacesEnabled()) throw forbidden('No autorizado');

        enforceRateLimit(`upload:user:${ctx.userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);

        const file = await readFormFile(req, 'file');
        if (!file) throw badRequest('No se ha subido ningún archivo');

        const ext = ALLOWED_TYPES[file.type];
        if (!ext) {
            throw badRequest('Tipo de archivo no válido: solo se admiten imágenes PNG, JPEG y WEBP.');
        }

        if (file.size > MAX_SIZE_BYTES) {
            throw new HttpError(413, 'El archivo es demasiado grande (máximo 8 MB).');
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Validate the actual bytes, not just the client-supplied MIME/extension.
        if (!isAllowedImage(buffer)) throw badRequest('El archivo no es una imagen válida');

        // Unpredictable filename with a whitelisted extension. It does NOT embed
        // the user id, so the URL leaks no information about the uploader.
        const filename = `${randomUUID()}.${ext}`;
        // Outside public/ (served only through the authenticated /uploads route).
        const directory = uploadDir();
        await mkdir(directory, { recursive: true });
        await writeFile(uploadFilePath(filename), buffer);

        return NextResponse.json({
            success: true,
            url: `/uploads/${filename}`
        });
    },
);
