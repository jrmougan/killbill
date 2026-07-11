import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getListWithItems } from "@/lib/list-read";
import { MembershipStatus } from "@/generated/prisma/enums";
import type { ListWriteScope } from "@/lib/list-crud";
import { ListDetailClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const raw = await prisma.shoppingList.findUnique({
        where: { id: listId },
        select: { groupId: true, ownerId: true },
    });
    if (!raw) redirect("/lists");

    let scope: ListWriteScope;
    if (raw.groupId) {
        // Group list: caller must be an ACTIVE member of the owning group.
        const membership = await prisma.membership.findUnique({
            where: { groupId_userId: { groupId: raw.groupId, userId } },
        });
        if (!membership || membership.status !== MembershipStatus.ACTIVE) redirect("/lists");
        scope = { kind: "group", groupId: raw.groupId };
    } else if (raw.ownerId === userId) {
        scope = { kind: "owner", ownerId: userId };
    } else {
        redirect("/lists");
    }

    const list = await getListWithItems(scope, listId);
    if (!list) redirect("/lists");

    const items = list.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        note: i.note,
        aisle: i.aisle,
        checked: i.checked,
    }));

    const isGroup = scope.kind === "group";
    const groupId = scope.kind === "group" ? scope.groupId : null;

    return (
        <ListDetailClient
            listId={list.id}
            name={list.name}
            description={list.description}
            items={items}
            isGroup={isGroup}
            groupId={groupId}
        />
    );
}
