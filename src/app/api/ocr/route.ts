import { NextResponse } from 'next/server';
import { getSessionCtx } from '@/lib/authz';
import { ephemeralSpacesEnabled } from '@/lib/flags';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { isAllowedImage, ALLOWED_IMAGE_TYPES as ALLOWED_TYPES, MAX_IMAGE_BYTES as MAX_SIZE_BYTES } from '@/lib/receipt-image';
import { analyzeReceiptImage, ReceiptAIError } from '@/lib/receipt-ocr-ai';

interface ReceiptItem {
    description: string;
    quantity: number;
    price: number;
    total: number;
    assignedTo: string | null;
}

export async function POST(request: Request) {
    // getSessionCtx revalidates guest sessions against the DB on every call
    // (revoked membership / archived space → null), unlike the raw JWT claim.
    const session = await getSessionCtx();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    // The whole guest surface is gated by EPHEMERAL_SPACES_ENABLED.
    if (session.kind === 'guest' && !ephemeralSpacesEnabled()) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    // Rate limit the paid AI OCR call: 10 requests / 5 minutes, keyed per
    // authenticated user (falls back to client IP if userId is somehow absent).
    const rateKey = session.userId ? `ocr:user:${session.userId}` : `ocr:ip:${getClientIp(request.headers)}`;
    const limit = rateLimit(rateKey, 10, 5 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json(
            { error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
        );
    }

    // Guests (product #5): OCR is allowed but capped PER SPACE PER DAY so a leaked
    // guest link can't run up the provider bill. The guest JWT carries its groupId
    // (already revalidated by getSessionCtx).
    // NOTE: like every rateLimit bucket this counter lives in process memory, so
    // it assumes a single replica (and resets on restart); scaling out needs a
    // shared store.
    if (session.kind === 'guest' && session.groupId) {
        const dayLimit = rateLimit(`ocr:space:${session.groupId}`, 50, 24 * 60 * 60 * 1000);
        if (!dayLimit.allowed) {
            return NextResponse.json(
                { error: 'Se alcanzó el límite diario de escaneos de este espacio.' },
                { status: 429, headers: { 'Retry-After': String(dayLimit.retryAfterSeconds) } }
            );
        }
    }

    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;

        if (!file) {
            return NextResponse.json({ error: 'No se ha enviado ninguna imagen' }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'Tipo de archivo no válido: solo se admiten imágenes PNG, JPEG y WEBP.' }, { status: 400 });
        }

        if (file.size > MAX_SIZE_BYTES) {
            return NextResponse.json({ error: 'El archivo es demasiado grande (máximo 8 MB).' }, { status: 413 });
        }

        // Convert file to base64
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Defensively validate the actual bytes before spending a provider call.
        if (!isAllowedImage(buffer)) {
            return NextResponse.json({ error: 'El archivo no es una imagen válida' }, { status: 400 });
        }

        const base64 = buffer.toString('base64');
        const mimeType = file.type || 'image/jpeg';

        const parsed = await analyzeReceiptImage(base64, mimeType);

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

    } catch (error) {
        if (error instanceof ReceiptAIError) {
            return NextResponse.json({ error: error.message }, { status: 502 });
        }
        console.error('OCR Error:', error);
        return NextResponse.json({ error: 'Error al procesar el ticket' }, { status: 500 });
    }
}
