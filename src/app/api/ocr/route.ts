import { NextResponse } from 'next/server';
import { ephemeralSpacesEnabled } from '@/lib/flags';
import { isAllowedImage, ALLOWED_IMAGE_TYPES as ALLOWED_TYPES, MAX_IMAGE_BYTES as MAX_SIZE_BYTES } from '@/lib/receipt-image';
import { analyzeReceiptImage, ReceiptAIError } from '@/lib/receipt-ocr-ai';
import { HttpError, badRequest, enforceRateLimit, forbidden, route } from '@/lib/http';
import { readFormFile } from '@/lib/form-file';

interface ReceiptItem {
    description: string;
    quantity: number;
    price: number;
    total: number;
    assignedTo: string | null;
}

// getSessionCtx (in route()) revalidates guest sessions against the DB on every
// call (revoked membership / archived space → null → 401), unlike the raw JWT claim.
export const POST = route(
    { auth: 'user-or-guest', errorMessage: 'Error al procesar el ticket', logLabel: 'OCR Error:' },
    async ({ req, ctx: session }) => {
        // The whole guest surface is gated by EPHEMERAL_SPACES_ENABLED.
        if (session.kind === 'guest' && !ephemeralSpacesEnabled()) throw forbidden('No autorizado');

        // Rate limit the paid AI OCR call: 10 requests / 5 minutes, keyed per
        // authenticated user (route() guarantees a userId).
        enforceRateLimit(`ocr:user:${session.userId}`, 10, 5 * 60 * 1000);

        // Guests (product #5): OCR is allowed but capped PER SPACE PER DAY so a leaked
        // guest link can't run up the provider bill. The guest JWT carries its groupId
        // (already revalidated by getSessionCtx).
        // NOTE: like every rateLimit bucket this counter lives in process memory, so
        // it assumes a single replica (and resets on restart); scaling out needs a
        // shared store.
        if (session.kind === 'guest' && session.groupId) {
            enforceRateLimit(
                `ocr:space:${session.groupId}`, 50, 24 * 60 * 60 * 1000,
                'Se alcanzó el límite diario de escaneos de este espacio.',
            );
        }

        const file = await readFormFile(req, 'image');
        if (!file) throw badRequest('No se ha enviado ninguna imagen');

        if (!ALLOWED_TYPES.includes(file.type)) {
            throw badRequest('Tipo de archivo no válido: solo se admiten imágenes PNG, JPEG y WEBP.');
        }

        if (file.size > MAX_SIZE_BYTES) {
            throw new HttpError(413, 'El archivo es demasiado grande (máximo 8 MB).');
        }

        // Convert file to base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Defensively validate the actual bytes before spending a provider call.
        if (!isAllowedImage(buffer)) throw badRequest('El archivo no es una imagen válida');

        const base64 = buffer.toString('base64');
        const mimeType = file.type || 'image/jpeg';

        let parsed: Awaited<ReturnType<typeof analyzeReceiptImage>>;
        try {
            parsed = await analyzeReceiptImage(base64, mimeType);
        } catch (error) {
            // Every AI provider failed / answered garbage: a bad gateway, not our 500.
            if (error instanceof ReceiptAIError) throw new HttpError(502, error.message);
            throw error;
        }

        // Ensure items have assignedTo field
        const items: ReceiptItem[] = (parsed.items || []).map(item => ({
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
            assignedTo: null
        }));

        return NextResponse.json({
            success: true,
            store: parsed.store,
            category: parsed.category,
            items,
            total: parsed.total
        });
    },
);
