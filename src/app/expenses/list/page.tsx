import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ExpensesListClient } from "./client";
import { getSession } from "@/lib/auth";
import { getGroupMembers } from "@/lib/membership";
import { toEuros } from "@/lib/currency";
import { categoryKeyOf, CATEGORY_REF_SELECT } from "@/lib/category-read";

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
    const members = await getGroupMembers(couple.id);

    // Fetch all expenses
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: couple.id, visibility: "SHARED" },
        include: { splits: true, ...CATEGORY_REF_SELECT },
        orderBy: { date: "desc" },
    });

    // Fetch all settlements
    const rawSettlements = await prisma.settlement.findMany({
        where: { coupleId: couple.id },
        include: { fromUser: true, toUser: true },
        orderBy: { date: "desc" },
    });

    // Merge and transform - convert cents to euros
    const items = [
        ...rawExpenses.map(e => ({
            id: e.id,
            type: "EXPENSE" as const,
            description: e.description,
            amount: toEuros(e.amount),
            date: e.date.toISOString(),
            // Phase 4 read-switch: the client's category filters key on the
            // relational Category (enum fallback), not the enum column.
            category: categoryKeyOf(e),
            paidBy: e.paidById,
            receiptUrl: e.receiptUrl,
            splits: e.splits.map(s => ({ userId: s.userId, amount: toEuros(s.amount) })),
        })),
        ...rawSettlements.map(s => ({
            id: s.id,
            type: "SETTLEMENT" as const,
            description: "Liquidación de deuda",
            amount: toEuros(s.amount),
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
