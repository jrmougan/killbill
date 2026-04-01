import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { toEuros } from "@/lib/currency";
import { BudgetClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { couple: true },
    });

    if (!user?.couple) redirect("/dashboard");

    const coupleId = user.couple.id;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [budgets, expenses] = await Promise.all([
        prisma.budget.findMany({
            where: { coupleId, month: monthStart },
            orderBy: { category: "asc" },
        }),
        prisma.expense.findMany({
            where: {
                coupleId,
                date: { gte: monthStart, lt: monthEnd },
            },
            select: { category: true, amount: true },
        }),
    ]);

    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        spentByCategory[e.category] = (spentByCategory[e.category] ?? 0) + e.amount;
    }

    const budgetData = budgets.map((budget) => {
        const spentCents = spentByCategory[budget.category] ?? 0;
        const percentage = budget.amount > 0 ? Math.round((spentCents / budget.amount) * 100) : 0;
        return {
            budget: {
                id: budget.id,
                category: budget.category,
                amount: parseFloat(toEuros(budget.amount).toFixed(2)),
                month: budget.month.toISOString(),
            },
            spent: parseFloat(toEuros(spentCents).toFixed(2)),
            percentage,
        };
    });

    const monthLabel = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

    return <BudgetClient budgetData={budgetData} monthLabel={monthLabel} />;
}
