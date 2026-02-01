import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ExpensesListClient } from "./client";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export default async function ExpensesListPage() {
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

    // Fetch all expenses
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: couple.id },
        include: { splits: true },
        orderBy: { date: "desc" },
    });

    // Fetch all settlements
    const rawSettlements = await prisma.settlement.findMany({
        where: { coupleId: couple.id },
        include: { fromUser: true, toUser: true },
        orderBy: { date: "desc" },
    });

    // Merge and transform
    const items = [
        ...rawExpenses.map(e => ({
            id: e.id,
            type: "EXPENSE" as const,
            description: e.description,
            amount: e.amount,
            date: e.date.toISOString(),
            category: e.category,
            paidBy: e.paidById,
            receiptUrl: e.receiptUrl,
            splits: e.splits.map(s => ({ userId: s.userId, amount: s.amount })),
        })),
        ...rawSettlements.map(s => ({
            id: s.id,
            type: "SETTLEMENT" as const,
            description: `Liquidación de deuda`,
            amount: s.amount,
            date: s.date.toISOString(),
            category: "settlement",
            paidBy: s.fromUserId,
            toUserId: s.toUserId,
            method: s.method,
            status: s.status
        }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Create users map
    const usersMap: Record<string, { id: string; name: string; avatar: string | null }> = {};
    members.forEach(m => {
        usersMap[m.id] = { id: m.id, name: m.name, avatar: m.avatar };
    });

    return <ExpensesListClient items={items} usersMap={usersMap} />;
}
