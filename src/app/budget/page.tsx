import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPrimaryGroup } from "@/lib/membership";
import { redirect } from "next/navigation";
import { toEuros } from "@/lib/currency";
import { categoryKeyOf, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { BudgetClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Phase 5 (WS1): resolve the group via the Membership layer.
    const coupleId = await getPrimaryGroup(userId);
    const hasCouple = Boolean(coupleId);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Server-render the SHARED (couple) budgets for first paint; the Personal tab
    // is loaded client-side. A user with no couple starts on the Personal tab.
    const [budgets, expenses] = hasCouple
        ? await Promise.all([
            prisma.budget.findMany({
                // Phase 4/5: select by half-open [periodStart, periodEnd) overlap
                // with the current month (same as the GET route), not `month`.
                where: { coupleId: coupleId!, periodStart: { lt: monthEnd }, periodEnd: { gt: monthStart } },
                orderBy: { category: "asc" },
                include: CATEGORY_REF_SELECT,
            }),
            prisma.expense.findMany({
                where: {
                    coupleId: coupleId!,
                    visibility: "SHARED",
                    date: { gte: monthStart, lt: monthEnd },
                },
                select: { category: true, amount: true, ...CATEGORY_REF_SELECT },
            }),
        ])
        : [[], []] as const;

    // Phase 4 read-switch: spend-by-category keys on the relational Category
    // (categoryRef.key, enum fallback) on BOTH sides of the budget↔expense match.
    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        const key = categoryKeyOf(e);
        spentByCategory[key] = (spentByCategory[key] ?? 0) + e.amount;
    }

    const budgetData = budgets.map((budget) => {
        const spentCents = spentByCategory[categoryKeyOf(budget)] ?? 0;
        const percentage = budget.amount > 0 ? Math.round((spentCents / budget.amount) * 100) : 0;
        return {
            budget: {
                id: budget.id,
                category: categoryKeyOf(budget),
                amount: parseFloat(toEuros(budget.amount).toFixed(2)),
                month: budget.periodStart.toISOString(),
            },
            spent: parseFloat(toEuros(spentCents).toFixed(2)),
            percentage,
        };
    });

    const rawMonthLabel = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

    return <BudgetClient budgetData={budgetData} monthLabel={monthLabel} hasCouple={hasCouple} />;
}
