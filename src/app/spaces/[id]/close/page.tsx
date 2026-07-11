import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MembershipStatus } from "@/generated/prisma/enums";
import { getGroupMembers } from "@/lib/membership";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { spaceTypeMeta } from "@/lib/space-ui";
import { CloseSpaceClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CloseSpacePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const [space, myMembership] = await Promise.all([
        prisma.couple.findUnique({ where: { id } }),
        prisma.membership.findUnique({ where: { groupId_userId: { groupId: id, userId } } }),
    ]);
    if (!space) redirect("/settings");
    if (!myMembership || myMembership.status !== MembershipStatus.ACTIVE) redirect("/settings");

    const [members, balances, settlements] = await Promise.all([
        getGroupMembers(id),
        getGroupBalances(id),
        prisma.settlement.findMany({ where: { coupleId: id }, orderBy: { date: "desc" } }),
    ]);

    const nameOf = (uid: string) => members.find((m) => m.id === uid)?.name ?? "Alguien";

    const myDebtsMap = resolveMyDebts(balances, userId);
    const myDebts = Object.entries(myDebtsMap)
        .filter(([, cents]) => cents > 0)
        .map(([targetId, cents]) => ({ userId: targetId, name: nameOf(targetId), amountCents: cents }));

    const settlementRows = settlements.map((s) => ({
        id: s.id,
        fromName: nameOf(s.fromUserId),
        toName: nameOf(s.toUserId),
        amountCents: s.amount,
        status: s.status,
    }));

    const canManage = myMembership.role === "OWNER" || myMembership.role === "ADMIN";

    return (
        <CloseSpaceClient
            spaceId={space.id}
            spaceName={space.name ?? spaceTypeMeta(space.type).label}
            status={space.status}
            myDebts={myDebts}
            settlements={settlementRows}
            canManage={canManage}
        />
    );
}
