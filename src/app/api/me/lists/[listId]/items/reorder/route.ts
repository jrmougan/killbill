import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { reorderItemsForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/** Reorder the items of a personal list ({ order: string[] }). */
export async function PATCH(request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const result = await reorderItemsForScope(scope, listId, body?.order);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
