import { NextResponse } from "next/server";
import { rateLimit } from "./rate-limit";
import { getListWithItems } from "./list-read";
import { isAllowedImage, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./receipt-image";
import { reconcileReceiptWithItems, type PendingItem } from "./receipt-reconcile";
import type { ListWriteScope } from "./list-crud";

/**
 * Shared body for the two reconcile routes (group + personal). Loads the list's
 * PENDING (unchecked) items, runs the paid Gemini match against the uploaded
 * receipt and returns SUGGESTIONS only — it never marks anything (the client
 * confirms and ticks via the normal idempotent toggle). Rate-limited per user.
 */
export async function runReconcile(request: Request, scope: ListWriteScope, listId: string, userId: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

    // Same budget as OCR: 10 paid vision calls / 5 min per user.
    const limit = rateLimit(`reconcile:user:${userId}`, 10, 5 * 60 * 1000);
    if (!limit.allowed) {
        return NextResponse.json(
            { error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." },
            { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
        );
    }

    const list = await getListWithItems(scope, listId);
    if (!list) return NextResponse.json({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" }, { status: 404 });

    const pending: PendingItem[] = list.items
        .filter((i) => !i.checked)
        .map((i) => ({ id: i.id, name: i.name }));
    if (pending.length === 0) return NextResponse.json({ matches: [] });

    let file: File | null = null;
    try {
        const formData = await request.formData();
        file = formData.get("image") as File | null;
    } catch {
        return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }
    if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return NextResponse.json({ error: "Tipo de archivo no válido. Solo PNG, JPEG o WEBP." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Archivo demasiado grande (máx. 8 MB)." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isAllowedImage(buffer)) {
        return NextResponse.json({ error: "Imagen no válida" }, { status: 400 });
    }

    try {
        const matches = await reconcileReceiptWithItems(apiKey, buffer.toString("base64"), file.type, pending);
        return NextResponse.json({ matches });
    } catch (e) {
        console.error("Reconcile error:", e);
        return NextResponse.json({ error: "No se pudo analizar el ticket" }, { status: 502 });
    }
}
