import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { checkoutList, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/**
 * PUENTE lista→gasto (feature estrella). Financial mutation: writability ACTIVE
 * required (default allowArchived:false → SETTLING/ARCHIVED rejected), GUEST out
 * of v1. Materializes the checked+priced+unlinked items into ONE SHARED expense
 * (split equally, ledger posted) and seals linkedExpenseId idempotently.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const result = await checkoutList(scope, listId, {
            actorUserId: auth.userId,
            paidById: body?.paidById,
            category: body?.category,
        });
        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}
