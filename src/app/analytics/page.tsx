import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { toEuros } from "@/lib/currency";
import { calculateBalances } from "@/lib/finance";
import { getCategoryById } from "@/lib/categories";
import { ReceiptItem } from "@/types";
import { AnalyticsClient } from "./client";

export const dynamic = "force-dynamic";

function getMonthLabel(date: Date): string {
    return date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
}

export default async function AnalyticsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: { members: true },
            },
        },
    });

    if (!user || !user.couple) redirect("/dashboard");

    const couple = user.couple;
    const members = couple.members;

    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [allExpenses, allSettlements] = await Promise.all([
        prisma.expense.findMany({
            where: {
                coupleId: couple.id,
                date: { gte: twelveMonthsAgo },
            },
            include: { splits: true },
            orderBy: { date: "asc" },
        }),
        prisma.settlement.findMany({
            where: {
                coupleId: couple.id,
                date: { gte: twelveMonthsAgo },
            },
            orderBy: { date: "asc" },
        }),
    ]);

    // 1. Monthly spending — last 6 months
    const monthlySpending = Array.from({ length: 6 }, (_, i) => {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);

        const monthExpenses = allExpenses.filter(e => {
            const d = new Date(e.date);
            return d >= monthDate && d < nextMonthDate;
        });

        const total = toEuros(monthExpenses.reduce((sum, e) => sum + e.amount, 0));

        const myShare = toEuros(
            monthExpenses.reduce((sum, e) => {
                const mySplit = e.splits.find(s => s.userId === userId);
                if (mySplit) return sum + mySplit.amount;
                return sum + Math.floor(e.amount / (members.length || 1));
            }, 0)
        );

        return {
            month: getMonthLabel(monthDate),
            total: parseFloat(total.toFixed(2)),
            myShare: parseFloat(myShare.toFixed(2)),
        };
    });

    // 2. Category breakdown for current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthExpenses = allExpenses.filter(e => new Date(e.date) >= startOfMonth);

    const categoryMap: Record<string, { amount: number; count: number }> = {};
    for (const e of currentMonthExpenses) {
        const cat = e.category || "other";
        if (!categoryMap[cat]) categoryMap[cat] = { amount: 0, count: 0 };
        categoryMap[cat].amount += toEuros(e.amount);
        categoryMap[cat].count += 1;
    }

    const categoryBreakdown = Object.entries(categoryMap)
        .map(([category, data]) => ({
            category,
            amount: parseFloat(data.amount.toFixed(2)),
            count: data.count,
            label: getCategoryById(category).label,
        }))
        .sort((a, b) => b.amount - a.amount);

    // 3. Balance evolution — one point per expense/settlement, sorted by date
    const effectiveSettlements = allSettlements.filter(s => s.status !== "REJECTED");

    const eventDates = [
        ...allExpenses.map(e => new Date(e.date)),
        ...effectiveSettlements.map(s => new Date(s.date)),
    ]
        .sort((a, b) => a.getTime() - b.getTime())
        .filter((d, i, arr) => i === 0 || d.getTime() !== arr[i - 1].getTime());

    const balanceEvolution = eventDates.map(date => {
        const expensesUpTo = allExpenses.filter(e => new Date(e.date) <= date);
        const settlementsUpTo = effectiveSettlements.filter(s => new Date(s.date) <= date);

        const balances = calculateBalances(
            members,
            expensesUpTo.map(e => ({
                paidById: e.paidById,
                amount: e.amount,
                splits: e.splits,
            })),
            settlementsUpTo,
            userId
        );

        return {
            date: date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            balance: parseFloat(toEuros(balances[userId] || 0).toFixed(2)),
        };
    });

    // 4. Stats cards
    const totalThisMonth = parseFloat(
        toEuros(currentMonthExpenses.reduce((sum, e) => sum + e.amount, 0)).toFixed(2)
    );

    const monthlyTotals = monthlySpending.map(m => m.total);
    const avgMonthly = parseFloat(
        (monthlyTotals.reduce((a, b) => a + b, 0) / (monthlyTotals.filter(t => t > 0).length || 1)).toFixed(2)
    );

    const topCategory = categoryBreakdown[0] ?? null;
    const expensesThisMonthCount = currentMonthExpenses.length;

    const stats = {
        totalThisMonth,
        avgMonthly,
        topCategory: topCategory ? topCategory.label : "—",
        expensesThisMonthCount,
    };

    // 5. Top 5 expenses this month
    const top5Expenses = [...currentMonthExpenses]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(e => ({
            id: e.id,
            description: e.description,
            category: e.category,
            categoryLabel: getCategoryById(e.category).label,
            amount: parseFloat(toEuros(e.amount).toFixed(2)),
            date: new Date(e.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
        }));

    // 6. Top products from receipt breakdowns — last 3 months
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const recentExpenses = allExpenses.filter(e => new Date(e.date) >= threeMonthsAgo);

    const itemMap: Record<string, { total: number; count: number }> = {};
    for (const e of recentExpenses) {
        const items = e.receiptData as unknown as ReceiptItem[] | null;
        if (!items || !Array.isArray(items)) continue;
        for (const item of items) {
            const key = item.description.trim().toLowerCase();
            if (!key) continue;
            if (!itemMap[key]) itemMap[key] = { total: 0, count: 0 };
            itemMap[key].total += item.total;
            itemMap[key].count += item.quantity > 0 ? item.quantity : 1;
        }
    }

    const topItems = Object.entries(itemMap)
        .map(([key, data]) => ({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            total: parseFloat(data.total.toFixed(2)),
            count: data.count,
            avgPrice: parseFloat((data.total / data.count).toFixed(2)),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 15);

    return (
        <AnalyticsClient
            monthlySpending={monthlySpending}
            categoryBreakdown={categoryBreakdown}
            balanceEvolution={balanceEvolution}
            stats={stats}
            top5Expenses={top5Expenses}
            topItems={topItems}
        />
    );
}
