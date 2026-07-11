import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { runReconcile } from "@/lib/reconcile-handler";
import type { ListWriteScope } from "@/lib/list-crud";

/**
 * Reconciliación OCR→lista (grupo). Sube una foto del ticket y devuelve
 * SUGERENCIAS de qué artículos pendientes aparecen en él (nunca marca nada; el
 * usuario confirma y el tick va por el toggle idempotente normal).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    return runReconcile(request, scope, listId, auth.userId);
}
