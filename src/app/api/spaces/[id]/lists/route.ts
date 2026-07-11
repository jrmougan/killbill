import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { createListForScope, reorderListsForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListsForScope } from "@/lib/list-read";
import { listErrorResponse } from "@/lib/list-http";

/**
 * Space-scoped shopping lists (Listas). `id` in the path IS the `groupId`.
 *
 * - GET: all lists of the space with per-list stats. Any ACTIVE member (GUEST out
 *   of v1); `allowArchived` so archived spaces still render their lists.
 * - POST: create a list — ANY ACTIVE member (no role gate). Default
 *   allowArchived:false blocks writes in SETTLING/ARCHIVED (assertSpaceWritable).
 * - PATCH: reorder the lists ({ order: string[] }).
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { allowArchived: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const lists = await getListsForScope({ kind: "group", groupId: id });
    return NextResponse.json({ lists });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const list = await createListForScope(scope, body, auth.userId);
        return NextResponse.json({ list }, { status: 201 });
    } catch (e) {
        return listErrorResponse(e);
    }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const result = await reorderListsForScope(scope, body?.order);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
