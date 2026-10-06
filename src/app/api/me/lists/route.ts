import { NextResponse } from "next/server";
import { createListForScope, reorderListsForScope, type ListWriteScope } from "@/lib/list-crud";
import { getListsForScope } from "@/lib/list-read";
import { route } from "@/lib/http";
import { ListBody, OrderBody, PERSONAL_LIST_ROUTE } from "./schemas";

/**
 * Personal shopping lists (scope `ownerId`). Authorized solely by the session
 * (route auth 'user': guests — shadow users caged to one ephemeral space — have
 * no personal lists); no space writability gate. Mirrors the space route but
 * delegates to the SAME lib with an owner scope.
 */

const ownerScope = (ownerId: string): ListWriteScope => ({ kind: "owner", ownerId });

export const GET = route(PERSONAL_LIST_ROUTE, async ({ ctx }) => {
    const lists = await getListsForScope(ownerScope(ctx.userId));
    return NextResponse.json({ lists });
});

export const POST = route({ ...PERSONAL_LIST_ROUTE, body: ListBody }, async ({ ctx, body }) => {
    const list = await createListForScope(ownerScope(ctx.userId), body, ctx.userId);
    return NextResponse.json({ list }, { status: 201 });
});

export const PATCH = route({ ...PERSONAL_LIST_ROUTE, body: OrderBody }, async ({ ctx, body }) => {
    const result = await reorderListsForScope(ownerScope(ctx.userId), body.order);
    return NextResponse.json(result);
});
