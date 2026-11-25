import { NextResponse } from "next/server";
import { getListVersion } from "@/lib/list-read";
import { spaceListParams } from "@/lib/list-schemas";
import { notFound, requireSpace, route } from "@/lib/http";

/**
 * Change stamp of a space list for the Listas poll: the client only refreshes
 * the screen (full RSC render) when it differs. Same read authorization as
 * GET …/lists: any ACTIVE member (guests denied), archived spaces readable.
 */
export const GET = route(
    { auth: "user", params: spaceListParams, unauthorizedMessage: "Unauthorized" },
    async ({ ctx, params: { id, listId } }) => {
        await requireSpace(ctx, id, { allowArchived: true });
        const version = await getListVersion({ kind: "group", groupId: id }, listId);
        if (version === null) throw notFound("Lista no encontrada", "LIST_NOT_FOUND");
        return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
    },
);
