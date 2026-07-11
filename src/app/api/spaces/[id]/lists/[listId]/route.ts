import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { updateListForScope, deleteListForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/**
 * A single space list. `id` = groupId, `listId` = the list. Any ACTIVE member may
 * rename/edit/delete (no role gate); writability gate blocks SETTLING/ARCHIVED.
 * The lib re-checks the list belongs to this group (defense in depth vs IDOR).
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const list = await updateListForScope(scope, listId, body);
        return NextResponse.json({ list });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const result = await deleteListForScope(scope, listId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
