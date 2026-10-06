import { NextResponse } from "next/server";
import { updateListForScope, deleteListForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { ListBody, listParams, PERSONAL_LIST_ROUTE } from "../schemas";

/** A single personal list (scope ownerId; the lib enforces ownership). Guests → 403. */

export const PATCH = route(
    { ...PERSONAL_LIST_ROUTE, params: listParams, body: ListBody },
    async ({ ctx, params: { listId }, body }) => {
        const list = await updateListForScope({ kind: "owner", ownerId: ctx.userId }, listId, body);
        return NextResponse.json({ list });
    },
);

export const DELETE = route({ ...PERSONAL_LIST_ROUTE, params: listParams }, async ({ ctx, params: { listId } }) => {
    const result = await deleteListForScope({ kind: "owner", ownerId: ctx.userId }, listId);
    return NextResponse.json(result);
});
