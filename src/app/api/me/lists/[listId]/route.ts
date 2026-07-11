import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { updateListForScope, deleteListForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/** A single personal list (scope ownerId; the lib enforces ownership). */

export async function PATCH(request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const list = await updateListForScope(scope, listId, body);
        return NextResponse.json({ list });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const result = await deleteListForScope(scope, listId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
