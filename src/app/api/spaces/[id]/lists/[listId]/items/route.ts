import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { createItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListWithItems } from "@/lib/list-read";
import { listErrorResponse } from "@/lib/list-http";

/**
 * Items of a space list. GET reads (any ACTIVE member, incl. archived spaces);
 * POST adds an item (any ACTIVE member, no role gate; writability blocks
 * SETTLING/ARCHIVED). sortOrder is allocated server-side (max+1).
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { allowArchived: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const list = await getListWithItems({ kind: "group", groupId: id }, listId);
    if (!list) return NextResponse.json({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ list: { id: list.id, name: list.name, description: list.description }, items: list.items });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const item = await createItemForScope(scope, listId, body);
        return NextResponse.json({ item }, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}
