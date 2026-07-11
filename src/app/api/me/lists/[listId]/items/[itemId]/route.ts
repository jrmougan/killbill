import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { updateItemForScope, setItemChecked, deleteItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/** A single item of a personal list. PATCH toggles `checked` or edits fields. */

export async function PATCH(request: Request, { params }: { params: Promise<{ listId: string; itemId: string }> }) {
    const { listId, itemId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        if (typeof body?.checked === "boolean") {
            const result = await setItemChecked(scope, listId, itemId, body.checked, ctx.userId);
            return NextResponse.json(result);
        }
        const item = await updateItemForScope(scope, listId, itemId, body);
        return NextResponse.json({ item });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ listId: string; itemId: string }> }) {
    const { listId, itemId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const result = await deleteItemForScope(scope, listId, itemId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
