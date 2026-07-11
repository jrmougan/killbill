import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getGroupMembers } from "@/lib/membership";
import { getListWithItems } from "@/lib/list-read";
import { MembershipStatus } from "@/generated/prisma/enums";
import type { ListWriteScope } from "@/lib/list-crud";
import { ListDetailClient, type DetailMember } from "./client";

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
    let members: DetailMember[] = [];
    if (raw.groupId) {
        // Group list: caller must be an ACTIVE member of the owning group.
        const membership = await prisma.membership.findUnique({
            where: { groupId_userId: { groupId: raw.groupId, userId } },
        });
        if (!membership || membership.status !== MembershipStatus.ACTIVE) redirect("/lists");
        scope = { kind: "group", groupId: raw.groupId };
        members = (await getGroupMembers(raw.groupId)).map((m) => ({ id: m.id, name: m.name }));
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
        priceCents: i.priceCents,
        note: i.note,
        checked: i.checked,
        linked: i.linkedExpenseId !== null,
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
            members={members}
            currentUserId={userId}
        />
    );
}
