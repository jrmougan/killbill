import { NextResponse } from "next/server";
import { clearCheckedForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { listParams, PERSONAL_LIST_ROUTE } from "../../schemas";

/** "Vaciar comprados" de una lista personal: BORRA los items marcados como comprados. Invitados → 403. */
export const POST = route({ ...PERSONAL_LIST_ROUTE, params: listParams }, async ({ ctx, params: { listId } }) => {
    const result = await clearCheckedForScope({ kind: "owner", ownerId: ctx.userId }, listId);
    return NextResponse.json(result);
});
