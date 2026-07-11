import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { checkoutList, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/**
 * PUENTE de una lista PERSONAL → gasto PERSONAL (visibility PERSONAL, sin split ni
 * ledger). Reutiliza el mismo lib que el puente de grupo; sella linkedExpenseId
 * idempotentemente.
 */
export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const result = await checkoutList(scope, listId, {
            actorUserId: ctx.userId,
            category: body?.category,
        });
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}
