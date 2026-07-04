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

    if (!user) redirect("/login");

    const coupleId = user.couple?.id ?? null;
    const hasCouple = Boolean(coupleId);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Server-render the SHARED (couple) budgets for first paint; the Personal tab
    // is loaded client-side. A user with no couple starts on the Personal tab.
    const [budgets, expenses] = hasCouple
        ? await Promise.all([
            prisma.budget.findMany({
                where: { coupleId: coupleId!, month: monthStart },
                orderBy: { category: "asc" },
            }),
            prisma.expense.findMany({
                where: {
                    coupleId: coupleId!,
                    visibility: "SHARED",
                    date: { gte: monthStart, lt: monthEnd },
                },
                select: { category: true, amount: true },
            }),
        ])
        : [[], []] as const;

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

    const rawMonthLabel = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

    return <BudgetClient budgetData={budgetData} monthLabel={monthLabel} hasCouple={hasCouple} />;
}
