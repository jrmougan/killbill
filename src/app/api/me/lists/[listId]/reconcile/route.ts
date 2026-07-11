import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { runReconcile } from "@/lib/reconcile-handler";
import type { ListWriteScope } from "@/lib/list-crud";

/** Reconciliación OCR→lista (lista personal). Devuelve sugerencias; no marca nada. */
export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    return runReconcile(request, scope, listId, ctx.userId);
}
