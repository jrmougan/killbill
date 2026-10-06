import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { getListVersion } from "@/lib/list-read";

/** Change stamp of a personal list for the Listas poll (scope ownerId; guests have no personal lists). */
export async function GET(_request: Request, { params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (ctx.kind === "guest") return NextResponse.json({ error: "Acción no permitida para invitados" }, { status: 403 });

    const version = await getListVersion({ kind: "owner", ownerId: ctx.userId }, listId);
    if (version === null) return NextResponse.json({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
