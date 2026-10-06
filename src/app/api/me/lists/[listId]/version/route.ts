import { NextResponse } from "next/server";
import { getListVersion } from "@/lib/list-read";
import { notFound, route } from "@/lib/http";
import { listParams, PERSONAL_LIST_ROUTE } from "../../schemas";

/** Change stamp of a personal list for the Listas poll (scope ownerId; guests have no personal lists). */
export const GET = route({ ...PERSONAL_LIST_ROUTE, params: listParams }, async ({ ctx, params: { listId } }) => {
    const version = await getListVersion({ kind: "owner", ownerId: ctx.userId }, listId);
    if (version === null) throw notFound("Lista no encontrada", "LIST_NOT_FOUND");
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
});
