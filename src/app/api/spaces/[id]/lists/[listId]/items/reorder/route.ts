import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { reorderItemsForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/** Reorder the items of a space list ({ order: string[] }). Any ACTIVE member. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const result = await reorderItemsForScope(scope, listId, body?.order);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
