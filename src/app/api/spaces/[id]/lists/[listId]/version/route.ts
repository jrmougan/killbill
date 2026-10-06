import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getListVersion } from "@/lib/list-read";

/**
 * Change stamp of a space list for the Listas poll: the client only refreshes
 * the screen (full RSC render) when it differs. Same read authorization as
 * GET …/lists: any ACTIVE member (guests denied), archived spaces readable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { allowArchived: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const version = await getListVersion({ kind: "group", groupId: id }, listId);
    if (version === null) return NextResponse.json({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
