import { NextResponse } from "next/server";
import { reorderItemsForScope, type ListWriteScope } from "@/lib/list-crud";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { OrderBody, spaceListParams } from "@/lib/list-schemas";
import { parseJson, route } from "@/lib/http";

/** Reorder the items of a space list ({ order: string[] }). Any ACTIVE member. */
export const PATCH = route(
    {
        auth: "user",
        params: spaceListParams,
        unauthorizedMessage: "Unauthorized",
        errorMessage: LIST_ERROR_MESSAGE,
        logLabel: LIST_ERROR_LOG_LABEL,
    },
    async ({ req, ctx, params: { id, listId } }) => {
        await requireListWrite(ctx, id);
        const { order } = await parseJson(req, OrderBody);
        const scope: ListWriteScope = { kind: "group", groupId: id };
        return NextResponse.json(await reorderItemsForScope(scope, listId, order));
    },
);
