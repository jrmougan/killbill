import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionCtx } from "@/lib/authz";
import { MembershipStatus } from "@/generated/prisma/enums";
import { getGroupMembers } from "@/lib/membership";
import { getGroupBalances } from "@/lib/ledger-read";
import { closePlan, openDebtCount } from "@/lib/close-plan";
import { archiveBlockReason, spaceTypeMeta } from "@/lib/space-ui";
import { settleUrlFor } from "@/lib/space-policy";
import { CloseSpaceClient, type CloseItem } from "./client";

export const dynamic = "force-dynamic";

/**
 * "Cerrar {espacio}": the three-step close checklist. Step 2 lists EVERY debt of
 * the space, not only mine: the PENDING payments plus the simplified plan from
 * the ledger balances (the same greedy matching /settle uses, per debtor). A
 * PENDING payment never posts to the ledger, so it is applied to the balances
 * before pairing (`closePlan`) to avoid listing the same money twice. CONFIRMED
 * history is not shown (there is no settlingAt to scope it to this close).
 */
export default async function CloseSpacePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    if (ctx.kind === "guest") redirect("/dashboard");
    const userId = ctx.userId;

    const [space, myMembership] = await Promise.all([
        prisma.couple.findUnique({ where: { id } }),
        prisma.membership.findUnique({ where: { groupId_userId: { groupId: id, userId } } }),
    ]);
    if (!space) redirect("/spaces");
    if (!myMembership || myMembership.status !== MembershipStatus.ACTIVE) redirect("/spaces");

    const [members, balances, pending] = await Promise.all([
        getGroupMembers(id),
        getGroupBalances(id),
        prisma.settlement.findMany({
            where: { coupleId: id, status: "PENDING", amount: { gt: 0 } },
            select: { id: true, fromUserId: true, toUserId: true, amount: true },
            orderBy: { date: "desc" },
        }),
    ]);

    const nameOf = (uid: string) => members.find((m) => m.id === uid)?.name ?? "Alguien";
    const items: CloseItem[] = pending.map((p) => ({
        kind: "pending",
        id: p.id,
        fromId: p.fromUserId,
        fromName: nameOf(p.fromUserId),
        toId: p.toUserId,
        toName: nameOf(p.toUserId),
        amountCents: p.amount,
    }));
    for (const d of closePlan(balances, pending)) {
        items.push({
            kind: "debt",
            id: `${d.fromId}>${d.toId}`,
            fromId: d.fromId,
            fromName: nameOf(d.fromId),
            toId: d.toId,
            toName: nameOf(d.toId),
            amountCents: d.amountCents,
        });
    }
    // Mine first (what I can act on), then the biggest amounts.
    const mine = (i: CloseItem) => (i.fromId === userId || i.toId === userId ? 0 : 1);
    items.sort((a, b) => mine(a) - mine(b) || b.amountCents - a.amountCents);

    const canManage = myMembership.role === "OWNER" || myMembership.role === "ADMIN";
    // Same predicate as the API's archive guard (any open balance, either sign).
    const blockReason = archiveBlockReason(pending.length, openDebtCount(balances));

    return (
        <CloseSpaceClient
            spaceId={space.id}
            spaceName={space.name ?? spaceTypeMeta(space.type).label}
            type={space.type}
            status={space.status}
            expiresAt={space.expiresAt ? space.expiresAt.toISOString() : null}
            viewerId={userId}
            items={items}
            canManage={canManage}
            settleHref={settleUrlFor(space.id)}
            archiveBlockReason={blockReason}
        />
    );
}
