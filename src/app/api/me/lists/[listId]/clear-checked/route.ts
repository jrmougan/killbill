import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { clearCheckedForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/** "Vaciar comprados" de una lista personal: BORRA los items marcados como comprados. */
export async function POST(_request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const result = await clearCheckedForScope(scope, listId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
