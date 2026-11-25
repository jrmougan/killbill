import { NextResponse } from "next/server";
import { createItemForScope } from "@/lib/list-crud";
import { getListWithItems } from "@/lib/list-read";
import { notFound, route } from "@/lib/http";
import { ItemBody, personalListParams, PERSONAL_LIST_ROUTE } from "@/lib/list-schemas";

/** Items of a personal list. Guests → 403. */

export const GET = route({ ...PERSONAL_LIST_ROUTE, params: personalListParams }, async ({ ctx, params: { listId } }) => {
    const list = await getListWithItems({ kind: "owner", ownerId: ctx.userId }, listId);
    if (!list) throw notFound("Lista no encontrada", "LIST_NOT_FOUND");
    return NextResponse.json({ list: { id: list.id, name: list.name, description: list.description }, items: list.items });
});

export const POST = route(
    { ...PERSONAL_LIST_ROUTE, params: personalListParams, body: ItemBody },
    async ({ ctx, params: { listId }, body }) => {
        const item = await createItemForScope({ kind: "owner", ownerId: ctx.userId }, listId, body);
        return NextResponse.json({ item }, { status: 201 });
    },
);
