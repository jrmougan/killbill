import { NextResponse } from "next/server";
import { clearCheckedForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse, requireListWriteAccess } from "@/lib/list-http";

/**
 * "Vaciar comprados" de una lista de grupo: BORRA (deleteMany) los items marcados
 * como comprados para reciclar la lista semanal. Cualquier miembro ACTIVE; solo un
 * espacio ARCHIVED bloquea la escritura (SETTLING la permite).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const gate = await requireListWriteAccess(id);
    if (!gate.ok) return gate.response;

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const result = await clearCheckedForScope(scope, listId);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
