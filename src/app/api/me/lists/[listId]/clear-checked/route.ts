import { NextResponse } from "next/server";
import { clearCheckedForScope } from "@/lib/list-crud";
import { route } from "@/lib/http";
import { ClearCheckedBody, personalListParams, PERSONAL_LIST_ROUTE } from "@/lib/list-schemas";

/** "Vaciar comprados" de una lista personal: BORRA los items marcados como comprados (solo `ids` si llega). Invitados → 403. */
export const POST = route({ ...PERSONAL_LIST_ROUTE, params: personalListParams, body: ClearCheckedBody }, async ({ ctx, params: { listId }, body }) => {
    const result = await clearCheckedForScope({ kind: "owner", ownerId: ctx.userId }, listId, body?.ids);
    return NextResponse.json(result);
});
