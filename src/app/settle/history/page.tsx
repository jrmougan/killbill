import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SettlementHistoryClient } from "./client";

export const dynamic = 'force-dynamic';

export default async function SettlementHistoryPage() {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

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
