import { prisma } from "@/lib/db";
import { categoryKeyOf, CATEGORY_REF_SELECT, type CategoryMeta } from "@/lib/category-read";
import { RECEIPT_LINES_SELECT } from "@/lib/receipt-read";
import { monthShort, type MonthScope } from "@/components/month/format";
import type { BudgetEntry, MonthAnalysis } from "@/components/month/types";

// Server reads for the "Mes" tab. Same queries the old /budget and /analytics
// pages ran (budget ↔ spend matched on the relational category key, budgets
// selected by half-open period overlap), parametrised by scope:
//   shared   → the active group's SHARED expenses / coupleId budgets
//   personal → the caller's PERSONAL expenses / ownerId budgets
// All amounts stay in cents; the client formats them.

type ScopeWhere = { scope: MonthScope; userId: string; groupId: string | null };

function expenseScope({ scope, userId, groupId }: ScopeWhere) {
    return scope === "personal"
        ? { ownerId: userId, visibility: "PERSONAL" as const }
        : { coupleId: groupId!, visibility: "SHARED" as const };
}

export async function loadBudgets(where: ScopeWhere, now: Date): Promise<BudgetEntry[]> {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const periodOverlap = { periodStart: { lt: monthEnd }, periodEnd: { gt: monthStart } };

    const [budgets, expenses] = await Promise.all([
        prisma.budget.findMany({
            where: where.scope === "personal"
                ? { ownerId: where.userId, ...periodOverlap }
                : { coupleId: where.groupId!, ...periodOverlap },
            orderBy: { categoryId: "asc" },
            include: CATEGORY_REF_SELECT,
        }),
        prisma.expense.findMany({
            where: { ...expenseScope(where), date: { gte: monthStart, lt: monthEnd } },
            select: { amount: true, ...CATEGORY_REF_SELECT },
        }),
    ]);

    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        const key = categoryKeyOf(e);
        spentByCategory[key] = (spentByCategory[key] ?? 0) + e.amount;
    }

    return budgets.map((b) => {
        const key = categoryKeyOf(b);
        return { id: b.id, category: key, amount: b.amount, spent: spentByCategory[key] ?? 0 };
    });
}

export async function loadAnalysis(
    where: ScopeWhere,
    now: Date,
    categories: CategoryMeta[],
    memberCount: number,
): Promise<MonthAnalysis> {
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    const expenses = await prisma.expense.findMany({
        where: { ...expenseScope(where), date: { gte: sixMonthsAgo } },
        select: {
            id: true,
            description: true,
            amount: true,
            date: true,
            splits: { select: { userId: true, amount: true } },
            ...CATEGORY_REF_SELECT,
            ...RECEIPT_LINES_SELECT,
        },
        orderBy: { date: "asc" },
    });

    // 1. Last 6 months (oldest → current).
    const months = Array.from({ length: 6 }, (_, i) => {
        const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
        const total = expenses
            .filter((e) => e.date >= start && e.date < end)
            .reduce((sum, e) => sum + e.amount, 0);
        return { label: monthShort(start), total };
    });

    const current = expenses.filter((e) => e.date >= monthStart);

    // 2. Current month by category (effective set metadata; unknown → other).
    const metaByKey = new Map(categories.map((c) => [c.key, c]));
    const byCat = new Map<string, number>();
    for (const e of current) {
        const key = categoryKeyOf(e);
        byCat.set(key, (byCat.get(key) ?? 0) + e.amount);
    }
    const byCategory = [...byCat.entries()]
        .map(([key, amount]) => {
            const meta = metaByKey.get(key) ?? metaByKey.get("other");
            return {
                key,
                label: meta?.label ?? key,
                emoji: meta?.emoji ?? "",
                iconName: meta?.iconName ?? "",
                hex: meta?.hex ?? "",
                amount,
            };
        })
        .sort((a, b) => b.amount - a.amount);

    // 3. "Tu parte" (shared only): my split, else an even share — same rule the
    //    old analytics chart used for expenses without a split row for me.
    const myShare = where.scope === "shared"
        ? current.reduce((sum, e) => {
            const mine = e.splits.find((s) => s.userId === where.userId);
            return sum + (mine ? mine.amount : Math.floor(e.amount / (memberCount || 1)));
        }, 0)
        : null;

    // 4. Top 5 expenses of the month.
    const topExpenses = [...current]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map((e) => ({
            id: e.id,
            description: e.description,
            category: categoryKeyOf(e),
            amount: e.amount,
            date: e.date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
        }));

    // 5. Most bought products (receipt line items are cents-native, last 3 months).
    const itemMap = new Map<string, { total: number; count: number }>();
    for (const e of expenses) {
        if (e.date < threeMonthsAgo) continue;
        for (const line of e.lineItems) {
            const key = line.description.trim().toLowerCase();
            if (!key) continue;
            const acc = itemMap.get(key) ?? { total: 0, count: 0 };
            acc.total += line.lineTotal;
            acc.count += line.quantity > 0 ? line.quantity : 1;
            itemMap.set(key, acc);
        }
    }
    const topItems = [...itemMap.entries()]
        .map(([key, d]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), total: d.total, count: d.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    return { months, byCategory, myShare, topExpenses, topItems };
}
