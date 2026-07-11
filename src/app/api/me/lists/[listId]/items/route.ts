import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { createItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListWithItems } from "@/lib/list-read";
import { listErrorResponse } from "@/lib/list-http";

/** Items of a personal list. */

export async function GET(_request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const list = await getListWithItems({ kind: "owner", ownerId: ctx.userId }, listId);
    if (!list) return NextResponse.json({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ list: { id: list.id, name: list.name, description: list.description }, items: list.items });
}

export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const item = await createItemForScope(scope, listId, body);
        return NextResponse.json({ item }, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}
