import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMyDebts } from "@/lib/finance";
import { SettleClient } from "./client";

export const dynamic = 'force-dynamic';

export default async function SettlePage() {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            activeGroup: {
                include: {
                    members: {
                        include: { user: true }
                    }
                }
            }
        }
    });

    if (!user || !user.activeGroup) {
        return redirect("/dashboard");
    }

    const { activeGroup } = user;
    const members = activeGroup.members.map(m => m.user);

    // Fetch Expenses for active group
    const rawExpenses = await prisma.expense.findMany({
        where: { groupId: activeGroup.id },
    });

    // Fetch Settlements for active group
    const settlements = await prisma.settlement.findMany({
        where: { groupId: activeGroup.id },
    });

    // Calculate My Debts (High Level)
    const myDebtsMap = getMyDebts(
        members,
        rawExpenses.map(e => ({ paidById: e.paidById, amount: e.amount })),
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
