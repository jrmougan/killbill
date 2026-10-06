import { NextResponse } from "next/server";
import { clearCheckedForScope, type ListWriteScope } from "@/lib/list-crud";
import { LIST_ERROR_LOG_LABEL, LIST_ERROR_MESSAGE, requireListWrite } from "@/lib/list-http";
import { spaceListParams } from "@/lib/list-schemas";
import { route } from "@/lib/http";

/**
 * "Vaciar comprados" de una lista de grupo: BORRA (deleteMany) los items marcados
 * como comprados para reciclar la lista semanal. Cualquier miembro ACTIVE; solo un
 * espacio ARCHIVED bloquea la escritura (SETTLING la permite).
 */
export const POST = route(
    {
        auth: "user",
        params: spaceListParams,
        unauthorizedMessage: "Unauthorized",
        errorMessage: LIST_ERROR_MESSAGE,
        logLabel: LIST_ERROR_LOG_LABEL,
    },
    async ({ ctx, params: { id, listId } }) => {
        await requireListWrite(ctx, id);
        const scope: ListWriteScope = { kind: "group", groupId: id };
        return NextResponse.json(await clearCheckedForScope(scope, listId));
    },
);
