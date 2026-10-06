import { NextResponse } from "next/server";
import { updateListForScope, deleteListForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { ListBody, personalListParams, PERSONAL_LIST_ROUTE } from "@/lib/list-schemas";

/** A single personal list (scope ownerId; the lib enforces ownership). Guests → 403. */

export const PATCH = route(
    { ...PERSONAL_LIST_ROUTE, params: personalListParams, body: ListBody },
    async ({ ctx, params: { listId }, body }) => {
        const list = await updateListForScope({ kind: "owner", ownerId: ctx.userId }, listId, body);
        return NextResponse.json({ list });
    },
);

export const DELETE = route({ ...PERSONAL_LIST_ROUTE, params: personalListParams }, async ({ ctx, params: { listId } }) => {
    const result = await deleteListForScope({ kind: "owner", ownerId: ctx.userId }, listId);
    return NextResponse.json(result);
});
