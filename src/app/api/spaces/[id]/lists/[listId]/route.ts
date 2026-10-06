import { NextResponse } from "next/server";
import { updateListForScope, deleteListForScope, type ListWriteScope } from "@/lib/list-crud";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { ListBody, spaceListParams } from "@/lib/list-schemas";
import { parseJson, route } from "@/lib/http";

/**
 * A single space list. `id` = groupId, `listId` = the list. Any ACTIVE member may
 * rename/edit/delete (no role gate); writes are blocked only when ARCHIVED (lists stay editable while SETTLING).
 * The lib re-checks the list belongs to this group (defense in depth vs IDOR).
 */
const options = {
    auth: "user",
    params: spaceListParams,
    unauthorizedMessage: "Unauthorized",
    errorMessage: LIST_ERROR_MESSAGE,
    logLabel: LIST_ERROR_LOG_LABEL,
} as const;

export const PATCH = route(options, async ({ req, ctx, params: { id, listId } }) => {
    await requireListWrite(ctx, id);
    const body = await parseJson(req, ListBody);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    const list = await updateListForScope(scope, listId, body);
    return NextResponse.json({ list });
});

export const DELETE = route(options, async ({ ctx, params: { id, listId } }) => {
    await requireListWrite(ctx, id);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    return NextResponse.json(await deleteListForScope(scope, listId));
});
