import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getSessionCtx } from '@/lib/authz';
import { ephemeralSpacesEnabled } from '@/lib/flags';
import { rateLimit } from '@/lib/rate-limit';
import { isAllowedImage, MAX_IMAGE_BYTES as MAX_SIZE_BYTES } from '@/lib/receipt-image';

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

export async function POST(request: Request) {
    // getSessionCtx revalidates guest sessions against the DB (revoked /
    // archived → null) instead of trusting the JWT claim.
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (ctx.kind === 'guest' && !ephemeralSpacesEnabled()) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const limit = rateLimit(`upload:user:${ctx.userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!limit.allowed) {
        return NextResponse.json(
            { error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No se ha subido ningún archivo' }, { status: 400 });
        }

        const ext = ALLOWED_TYPES[file.type];
        if (!ext) {
            return NextResponse.json({ error: 'Tipo de archivo no válido: solo se admiten imágenes PNG, JPEG y WEBP.' }, { status: 400 });
        }

        if (file.size > MAX_SIZE_BYTES) {
            return NextResponse.json({ error: 'El archivo es demasiado grande (máximo 8 MB).' }, { status: 413 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Validate the actual bytes, not just the client-supplied MIME/extension.
        if (!isAllowedImage(buffer)) {
            return NextResponse.json({ error: 'El archivo no es una imagen válida' }, { status: 400 });
        }

        // Unpredictable filename with a whitelisted extension. It does NOT embed
        // the user id, so the URL leaks no information about the uploader.
        const filename = `${randomUUID()}.${ext}`;
        const directory = join(process.cwd(), 'public', 'uploads');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, filename), buffer);

        return NextResponse.json({
            success: true,
            url: `/uploads/${filename}`
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        return NextResponse.json({ error: 'No se pudo subir el archivo' }, { status: 500 });
    }
}
