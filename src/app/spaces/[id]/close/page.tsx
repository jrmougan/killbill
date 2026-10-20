import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionCtx } from "@/lib/authz";
import { MembershipStatus } from "@/generated/prisma/enums";
import { getGroupMembers } from "@/lib/membership";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { archiveBlockReason, spaceTypeMeta } from "@/lib/space-ui";
import { hasOpenBalance, settleUrlFor } from "@/lib/space-policy";
import { CloseSpaceClient, type CloseItem } from "./client";

export const dynamic = "force-dynamic";

/**
 * "Cerrar {espacio}": the three-step close checklist. Step 2 lists EVERY debt of
 * the space, not only mine: the PENDING payments plus the simplified plan from
 * the ledger balances (the same greedy matching /settle uses, per debtor). A
 * PENDING payment never posts to the ledger, so it is subtracted from its
 * pair's planned debt to avoid listing the same money twice. CONFIRMED
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
    const pendingByPair = new Map<string, number>();
    for (const p of pending) {
        const key = `${p.fromUserId}>${p.toUserId}`;
        pendingByPair.set(key, (pendingByPair.get(key) ?? 0) + p.amount);
    }

    const items: CloseItem[] = pending.map((p) => ({
        kind: "pending",
        id: p.id,
        fromId: p.fromUserId,
        fromName: nameOf(p.fromUserId),
        toId: p.toUserId,
        toName: nameOf(p.toUserId),
        amountCents: p.amount,
    }));
    for (const debtorId of Object.keys(balances)) {
        for (const [creditorId, cents] of Object.entries(resolveMyDebts(balances, debtorId))) {
            const open = cents - (pendingByPair.get(`${debtorId}>${creditorId}`) ?? 0);
            if (open <= 0) continue;
            items.push({
                kind: "debt",
                id: `${debtorId}>${creditorId}`,
                fromId: debtorId,
                fromName: nameOf(debtorId),
                toId: creditorId,
                toName: nameOf(creditorId),
                amountCents: open,
            });
        }
    }
    // Mine first (what I can act on), then the biggest amounts.
    const mine = (i: CloseItem) => (i.fromId === userId || i.toId === userId ? 0 : 1);
    items.sort((a, b) => mine(a) - mine(b) || b.amountCents - a.amountCents);

    const canManage = myMembership.role === "OWNER" || myMembership.role === "ADMIN";
    const openDebts = Object.values(balances).filter((c) => c < 0 && hasOpenBalance(c)).length;
    const blockReason = archiveBlockReason(pending.length, openDebts);

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
