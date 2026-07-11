import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { createListForScope, reorderListsForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListsForScope } from "@/lib/list-read";
import { listErrorResponse } from "@/lib/list-http";

/**
 * Personal shopping lists (scope `ownerId`). Authorized solely by the session
 * (`getSessionCtx`); no space writability gate. Mirrors the space route but
 * delegates to the SAME lib with an owner scope.
 */

export async function GET() {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const lists = await getListsForScope({ kind: "owner", ownerId: ctx.userId });
    return NextResponse.json({ lists });
}

export async function POST(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const list = await createListForScope(scope, body, ctx.userId);
        return NextResponse.json({ list }, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function PATCH(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope: ListWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const result = await reorderListsForScope(scope, body?.order);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
