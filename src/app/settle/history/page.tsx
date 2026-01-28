import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SettlementHistoryClient } from "./client";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export default async function SettlementHistoryPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { coupleId: true }
    });

    if (!user?.coupleId) redirect("/dashboard");

    const settlements = await prisma.settlement.findMany({
        where: {
            coupleId: user.coupleId
        },
        include: {
            fromUser: true,
            toUser: true,
        },
        orderBy: { date: 'desc' }
    });

    return <SettlementHistoryClient settlements={settlements} currentUserId={userId} />;
}
