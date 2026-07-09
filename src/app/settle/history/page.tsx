import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { SettlementHistoryClient } from "./client";
import { getSession } from "@/lib/auth";
import { getPrimaryGroup } from "@/lib/membership";

export const dynamic = 'force-dynamic';

export default async function SettlementHistoryPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Phase 4 selector switch: resolve my group via the Membership layer.
    const groupId = await getPrimaryGroup(userId);

    if (!groupId) redirect("/dashboard");

    const settlements = await prisma.settlement.findMany({
        where: {
            coupleId: groupId
        },
        include: {
            fromUser: true,
            toUser: true,
        },
        orderBy: { date: 'desc' }
    });

    return <SettlementHistoryClient settlements={settlements} currentUserId={userId} />;
}
