import { NextResponse } from "next/server";
import { updateItemForScope, setItemChecked, deleteItemForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { ItemBody, itemParams, PERSONAL_LIST_ROUTE } from "../../../schemas";

/** A single item of a personal list. PATCH toggles `checked` or edits fields. Guests → 403. */

export const PATCH = route(
    { ...PERSONAL_LIST_ROUTE, params: itemParams, body: ItemBody },
    async ({ ctx, params: { listId, itemId }, body }) => {
        const scope = { kind: "owner", ownerId: ctx.userId } as const;
        if (typeof body.checked === "boolean") {
            const result = await setItemChecked(scope, listId, itemId, body.checked, ctx.userId);
            return NextResponse.json(result);
        }
        const item = await updateItemForScope(scope, listId, itemId, body);
        return NextResponse.json({ item });
    },
);

export const DELETE = route(
    { ...PERSONAL_LIST_ROUTE, params: itemParams },
    async ({ ctx, params: { listId, itemId } }) => {
        const result = await deleteItemForScope({ kind: "owner", ownerId: ctx.userId }, listId, itemId);
        return NextResponse.json(result);
    },
);
