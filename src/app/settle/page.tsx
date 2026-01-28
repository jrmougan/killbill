import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMyDebts } from "@/lib/finance";
import { SettleClient } from "./client";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export default async function SettlePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!user || !user.couple) {
        return redirect("/dashboard");
    }

    const { couple } = user;
    const members = couple.members;

    // Fetch Expenses for couple with splits
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: couple.id },
        include: { splits: true },
    });

    // Fetch Settlements for couple
    const settlements = await prisma.settlement.findMany({
        where: { coupleId: couple.id },
    });

    // Calculate My Debts (High Level)
    const myDebtsMap = getMyDebts(
        members,
        rawExpenses.map(e => ({ paidById: e.paidById, amount: e.amount, splits: e.splits.map(s => ({ userId: s.userId, amount: s.amount })) })),
        settlements,
        userId
    );

    // Format for client
    const debts = Object.entries(myDebtsMap).map(([targetId, amount]) => {
        const targetUser = members.find(u => u.id === targetId);
        return {
            userId: targetId,
            name: targetUser?.name || "Unknown",
            avatar: targetUser?.avatar || "👤",
            amount: amount
        };
    });

    return <SettleClient debts={debts} />;
}
