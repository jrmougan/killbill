import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMyDebts, getLastSettlementDate } from "@/lib/finance";
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

    // Find local cutoff date
    // We want expenses NEWER than the last settlement
    const lastSettlementDate = getLastSettlementDate(settlements);

    // Fetch unsettled expenses where I owe money
    // Logic change: We show expenses since the last settlement, regardless of status (as status is deprecated)
    const unsettledExpenses = rawExpenses
        .filter(e => new Date(e.date) > lastSettlementDate && e.paidById !== userId)
        .map(e => {
            // Find my split or 50%
            let myAmount = 0;
            if (e.splits.length > 0) {
                myAmount = e.splits.find(s => s.userId === userId)?.amount || 0;
            } else {
                myAmount = e.amount / members.length;
            }
            return {
                id: e.id,
                description: e.description,
                amount: e.amount,
                myAmount,
                date: e.date.toISOString(),
                category: e.category,
                paidBy: e.paidById
            };
        })
        .filter(e => e.myAmount > 0)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const partner = members.find(m => m.id !== userId);

    return <SettleClient
        debts={debts}
        expenses={unsettledExpenses}
        partner={partner ? {
            id: partner.id,
            name: partner.name,
            avatar: partner.avatar || "👤"
        } : null}
    />;
}
