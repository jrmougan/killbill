import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { clearCheckedForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse } from "@/lib/list-http";

/**
 * "Vaciar comprados" de una lista de grupo: BORRA (deleteMany) los items marcados
 * como comprados para reciclar la lista semanal. Cualquier miembro ACTIVE; la
 * escribibilidad bloquea SETTLING/ARCHIVED.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const result = await clearCheckedForScope(scope, listId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
