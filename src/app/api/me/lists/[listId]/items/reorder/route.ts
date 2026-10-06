import { NextResponse } from "next/server";
import { reorderItemsForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { listParams, OrderBody, PERSONAL_LIST_ROUTE } from "../../../schemas";

/** Reorder the items of a personal list ({ order: string[] }). Guests → 403. */
export const PATCH = route(
    { ...PERSONAL_LIST_ROUTE, params: listParams, body: OrderBody },
    async ({ ctx, params: { listId }, body }) => {
        const result = await reorderItemsForScope({ kind: "owner", ownerId: ctx.userId }, listId, body.order);
        return NextResponse.json(result);
    },
);
