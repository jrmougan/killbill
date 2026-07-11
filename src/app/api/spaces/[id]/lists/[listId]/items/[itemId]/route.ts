import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { updateItemForScope, setItemChecked, deleteItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/**
 * A single item. PATCH either TOGGLES `checked` (idempotent condition-by-id
 * updateMany — the `checked` flag is a system field derived server-side, actor =
 * caller) or edits its fields. DELETE removes it. Any ACTIVE member; writability
 * blocks SETTLING/ARCHIVED.
 */

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; listId: string; itemId: string }> },
) {
    const { id, listId, itemId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        // Toggle mode: a boolean `checked` is the sole system-derived field.
        if (typeof body?.checked === "boolean") {
            const result = await setItemChecked(scope, listId, itemId, body.checked, auth.userId);
            return NextResponse.json(result);
        }
        const item = await updateItemForScope(scope, listId, itemId, body);
        return NextResponse.json({ item });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string; listId: string; itemId: string }> },
) {
    const { id, listId, itemId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const result = await deleteItemForScope(scope, listId, itemId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
