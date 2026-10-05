import { NextResponse } from "next/server";
import { reorderItemsForScope, type ListWriteScope } from "@/lib/list-crud";
import { listErrorResponse, requireListWriteAccess } from "@/lib/list-http";

/** Reorder the items of a space list ({ order: string[] }). Any ACTIVE member. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
    const { id, listId } = await params;
    const gate = await requireListWriteAccess(id);
    if (!gate.ok) return gate.response;

    const scope: ListWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const result = await reorderItemsForScope(scope, listId, body?.order);
        return NextResponse.json(result);
    } catch (e) {
        return listErrorResponse(e);
    }
}
