import { NextResponse } from "next/server";
import { createListForScope, reorderListsForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListsForScope } from "@/lib/list-read";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { ListBody, OrderBody } from "@/lib/list-schemas";
import { parseJson, requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";

/**
 * Space-scoped shopping lists (Listas). `id` in the path IS the `groupId`.
 *
 * - GET: all lists of the space with per-list stats. Any ACTIVE member (GUEST out
 *   of v1); `allowArchived` so archived spaces still render their lists.
 * - POST: create a list — ANY ACTIVE member (no role gate). Writes are
 *   blocked only in ARCHIVED spaces (requireListWrite): SETTLING allows lists.
 * - PATCH: reorder the lists ({ order: string[] }).
 *
 * Bodies are parsed AFTER the space gate (a stranger learns nothing from a 400).
 */
const options = {
    auth: "user",
    params: idParams,
    unauthorizedMessage: "Unauthorized",
    errorMessage: LIST_ERROR_MESSAGE,
    logLabel: LIST_ERROR_LOG_LABEL,
} as const;

export const GET = route(options, async ({ ctx, params: { id } }) => {
    await requireSpace(ctx, id, { allowArchived: true });
    const lists = await getListsForScope({ kind: "group", groupId: id });
    return NextResponse.json({ lists });
});

export const POST = route(options, async ({ req, ctx, params: { id } }) => {
    const auth = await requireListWrite(ctx, id);
    const body = await parseJson(req, ListBody);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    const list = await createListForScope(scope, body, auth.userId);
    return NextResponse.json({ list }, { status: 201 });
});

export const PATCH = route(options, async ({ req, ctx, params: { id } }) => {
    await requireListWrite(ctx, id);
    const { order } = await parseJson(req, OrderBody);
    const scope: ListWriteScope = { kind: "group", groupId: id };
    return NextResponse.json(await reorderListsForScope(scope, order));
});
