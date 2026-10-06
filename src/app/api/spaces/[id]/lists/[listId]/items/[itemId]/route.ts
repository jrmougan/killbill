import { NextResponse } from "next/server";
import { updateItemForScope, setItemChecked, deleteItemForScope, type ListWriteScope } from "@/lib/list-crud";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { ItemPatchBody, spaceItemParams } from "@/lib/list-schemas";
import { parseJson, route } from "@/lib/http";

/**
 * A single item. PATCH either TOGGLES `checked` (idempotent condition-by-id
 * updateMany — the `checked` flag is a system field derived server-side, actor =
 * caller) or edits its fields. DELETE removes it. Any ACTIVE member; writes blocked
 * only when ARCHIVED (SETTLING allows list edits: planning is not spending).
 */
const options = {
    auth: "user",
    params: spaceItemParams,
    unauthorizedMessage: "Unauthorized",
    errorMessage: LIST_ERROR_MESSAGE,
    logLabel: LIST_ERROR_LOG_LABEL,
} as const;

export const PATCH = route(options, async ({ req, ctx, params: { id, listId, itemId } }) => {
    const auth = await requireListWrite(ctx, id);
    const body = await parseJson(req, ItemPatchBody);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    // Toggle mode: a boolean `checked` is the sole system-derived field.
    if (typeof body.checked === "boolean") {
        return NextResponse.json(await setItemChecked(scope, listId, itemId, body.checked, auth.userId));
    }
    const item = await updateItemForScope(scope, listId, itemId, body);
    return NextResponse.json({ item });
});

export const DELETE = route(options, async ({ ctx, params: { id, listId, itemId } }) => {
    await requireListWrite(ctx, id);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    return NextResponse.json(await deleteItemForScope(scope, listId, itemId));
});
