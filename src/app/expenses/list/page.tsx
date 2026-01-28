import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ExpensesListClient } from "./client";

export const dynamic = 'force-dynamic';

export default async function ExpensesListPage() {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

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

    // Transform for client
    const expenses = rawExpenses.map(e => ({
        id: e.id,
        description: e.description,
        amount: e.amount,
        date: e.date.toISOString(),
        category: e.category,
        paidBy: e.paidById,
        receiptUrl: e.receiptUrl,
        splits: e.splits.map(s => ({ userId: s.userId, amount: s.amount })),
    }));

    // Create users map
    const usersMap: Record<string, { id: string; name: string; avatar: string | null }> = {};
    members.forEach(m => {
        usersMap[m.id] = { id: m.id, name: m.name, avatar: m.avatar };
    });

    return <ExpensesListClient expenses={expenses} usersMap={usersMap} />;
}
