import { NextResponse } from "next/server";
import { createItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListWithItems } from "@/lib/list-read";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { ItemBody, spaceListParams } from "@/lib/list-schemas";
import { notFound, parseJson, requireSpace, route } from "@/lib/http";

/**
 * Items of a space list. GET reads (any ACTIVE member, incl. archived spaces);
 * POST adds an item (any ACTIVE member, no role gate; writes blocked only
 * when ARCHIVED; SETTLING allows list edits). sortOrder is allocated server-side (max+1).
 */
const options = {
    auth: "user",
    params: spaceListParams,
    unauthorizedMessage: "Unauthorized",
    errorMessage: LIST_ERROR_MESSAGE,
    logLabel: LIST_ERROR_LOG_LABEL,
} as const;

export const GET = route(options, async ({ ctx, params: { id, listId } }) => {
    await requireSpace(ctx, id, { allowArchived: true });
    const list = await getListWithItems({ kind: "group", groupId: id }, listId);
    if (!list) throw notFound("Lista no encontrada", "LIST_NOT_FOUND");
    return NextResponse.json({ list: { id: list.id, name: list.name, description: list.description }, items: list.items });
});

export const POST = route(options, async ({ req, ctx, params: { id, listId } }) => {
    await requireListWrite(ctx, id);
    const body = await parseJson(req, ItemBody);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    const item = await createItemForScope(scope, listId, body);
    return NextResponse.json({ item }, { status: 201 });
});
