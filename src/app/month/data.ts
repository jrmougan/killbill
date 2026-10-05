import { prisma } from "@/lib/db";
import { categoryKeyOf, CATEGORY_REF_SELECT, type CategoryMeta } from "@/lib/category-read";
import { RECEIPT_LINES_SELECT } from "@/lib/receipt-read";
import { monthRange } from "@/lib/month-range";
import { dayMonth, type MonthScope } from "@/components/month/format";
import {
    averageMonthly,
    balanceAtMonthEnds,
    compareWithPrevious,
    inBucket,
    lastMonths,
    monthSeries,
    shareOf,
} from "@/components/month/aggregate";
import type { BudgetEntry, MonthAnalysis } from "@/components/month/types";

// Server reads for the "Mes" tab, parametrised by scope:
//   shared   → the active group's SHARED expenses / coupleId budgets
//   personal → the caller's PERSONAL expenses / ownerId budgets
// Every "month" is the Europe/Madrid half-open range from monthRange() — the
// same window Inicio and Espacios use — so totals, categories, top expenses and
// "Tu parte" always add up and a future-dated expense never leaks into today.
// All amounts stay in cents; the client formats them.

type ScopeWhere = { scope: MonthScope; userId: string; groupId: string | null };

function expenseScope({ scope, userId, groupId }: ScopeWhere) {
    return scope === "personal"
        ? { ownerId: userId, visibility: "PERSONAL" as const }
        : { coupleId: groupId!, visibility: "SHARED" as const };
}

// Budget rows store their period at the midnight of whatever TZ wrote them
// (server-local). Shrinking the overlap window by 14 h (the widest UTC offset)
// keeps the current month's budget and never picks up the adjacent month's one
// because of a few hours of timezone skew.
const TZ_SLACK_MS = 14 * 3_600_000;

export async function loadBudgets(
    where: ScopeWhere,
    now: Date,
): Promise<{ budgets: BudgetEntry[]; spentByCategory: Record<string, number> }> {
    const { start, end } = monthRange(now);
    const periodOverlap = {
        periodStart: { lt: new Date(end.getTime() - TZ_SLACK_MS) },
        periodEnd: { gt: new Date(start.getTime() + TZ_SLACK_MS) },
    };

    const [budgets, expenses] = await Promise.all([
        prisma.budget.findMany({
            where: where.scope === "personal"
                ? { ownerId: where.userId, ...periodOverlap }
                : { coupleId: where.groupId!, ...periodOverlap },
            orderBy: { categoryId: "asc" },
            include: CATEGORY_REF_SELECT,
        }),
        prisma.expense.findMany({
            where: { ...expenseScope(where), date: { gte: start, lt: end } },
            select: { amount: true, ...CATEGORY_REF_SELECT },
        }),
    ]);

    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        const key = categoryKeyOf(e);
        spentByCategory[key] = (spentByCategory[key] ?? 0) + e.amount;
    }

    return {
        budgets: budgets.map((b) => {
            const key = categoryKeyOf(b);
            return { id: b.id, category: key, amount: b.amount, spent: spentByCategory[key] ?? 0 };
        }),
        spentByCategory,
    };
}

export async function loadAnalysis(
    where: ScopeWhere,
    now: Date,
    categories: CategoryMeta[],
    memberCount: number,
): Promise<MonthAnalysis> {
    const buckets = lastMonths(now, 6);
    const current = buckets[buckets.length - 1];
    const shared = where.scope === "shared";

    const [expenses, ledger] = await Promise.all([
        prisma.expense.findMany({
            where: { ...expenseScope(where), date: { gte: buckets[0].start, lt: current.end } },
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
        }),
        shared
            ? prisma.ledgerEntry.findMany({
                where: { account: { groupId: where.groupId!, userId: where.userId } },
                select: { amount: true, transaction: { select: { postedAt: true } } },
            })
            : Promise.resolve(null),
    ]);

    // 1. Last 6 months (oldest → current): total, count and my share.
    const months = monthSeries(expenses, buckets, { userId: where.userId, memberCount, shared });
    const thisMonth = expenses.filter((e) => inBucket(e.date, current));

    // 2. Current month by category (effective set metadata; unknown → other).
    const metaByKey = new Map(categories.map((c) => [c.key, c]));
    const byCat = new Map<string, number>();
    for (const e of thisMonth) {
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

    // 3. "Tu parte" (shared only): my split, else an even share.
    const myShare = shared
        ? thisMonth.reduce((sum, e) => sum + shareOf(e, where.userId, memberCount), 0)
        : null;

    // 4. Top 5 expenses of the month.
    const topExpenses = [...thisMonth]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map((e) => ({
            id: e.id,
            description: e.description,
            category: categoryKeyOf(e),
            amount: e.amount,
            date: dayMonth(e.date),
        }));

    // 5. Most bought products (receipt line items are cents-native, last 3 months).
    const threeMonthsStart = buckets[buckets.length - 3].start;
    const itemMap = new Map<string, { total: number; count: number }>();
    for (const e of expenses) {
        if (e.date < threeMonthsStart) continue;
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

    // 6. Balance evolution (shared only): my ledger balance at each month end.
    const balance = ledger
        ? balanceAtMonthEnds(
            ledger.map((l) => ({ amount: l.amount, postedAt: l.transaction.postedAt })),
            buckets,
        )
        : null;

    return {
        months,
        byCategory,
        myShare,
        comparison: compareWithPrevious(months),
        kpis: {
            avgMonthly: averageMonthly(months),
            count: thisMonth.length,
            topCategory: byCategory[0]?.label ?? null,
        },
        balance,
        topExpenses,
        topItems,
    };
}
