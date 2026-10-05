import { NextResponse } from "next/server";
import { updateItemForScope, setItemChecked, deleteItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse, requireListWriteAccess } from "@/lib/list-http";

/**
 * A single item. PATCH either TOGGLES `checked` (idempotent condition-by-id
 * updateMany — the `checked` flag is a system field derived server-side, actor =
 * caller) or edits its fields. DELETE removes it. Any ACTIVE member; writes blocked
 * only when ARCHIVED (SETTLING allows list edits: planning is not spending).
 */

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; listId: string; itemId: string }> },
) {
    const { id, listId, itemId } = await params;
    const gate = await requireListWriteAccess(id);
    if (!gate.ok) return gate.response;

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        // Toggle mode: a boolean `checked` is the sole system-derived field.
        if (typeof body?.checked === "boolean") {
            const result = await setItemChecked(scope, listId, itemId, body.checked, gate.auth.userId);
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
    const gate = await requireListWriteAccess(id);
    if (!gate.ok) return gate.response;

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const result = await deleteItemForScope(scope, listId, itemId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
