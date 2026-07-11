import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ExpensesListClient } from "./client";
import { getSession } from "@/lib/auth";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { NoGroupState } from "@/components/ui/no-group-state";
import { toEuros } from "@/lib/currency";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { NEUTRAL_CATEGORY_META, type CategoryBadgeMeta } from "@/components/category/category-badge";

export const dynamic = 'force-dynamic';

export default async function ExpensesListPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    const isGuest = session.kind === "guest";

    // Phase 5 (WS1): resolve the group + members via the Membership layer.
    const groupId = await getActiveGroup(userId);
    if (!groupId) {
        return <NoGroupState title="Gastos del grupo" />;
    }

    const members = await getGroupMembers(groupId);

    // DB-driven effective category set for the space (system ∪ space-custom).
    // Built once and used to (a) tag each expense with its render metadata and
    // (b) feed the filter chips — including any orphaned keys present on items.
    const catList = await getEffectiveCategories({ groupId });
    const catMap = categoryMetaMap(catList);
    const metaFor = (key: string): CategoryBadgeMeta =>
        catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META;

    // Fetch all expenses
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: groupId, visibility: "SHARED" },
        include: { splits: true, ...CATEGORY_REF_SELECT },
        orderBy: { date: "desc" },
    });

    // Fetch all settlements
    const rawSettlements = await prisma.settlement.findMany({
        where: { coupleId: groupId },
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
            categoryMeta: metaFor(categoryKeyOf(e)),
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

    // Filter chips = the effective set plus any orphaned keys present on items
    // (a deleted custom category still showing on old expenses stays filterable).
    const presentKeys = new Set(rawExpenses.map((e) => categoryKeyOf(e)));
    const orphanKeys = [...presentKeys].filter((k) => !catMap[k]);
    const filterCategories: CategoryBadgeMeta[] = [
        ...catList,
        ...orphanKeys.map((k) => ({ ...NEUTRAL_CATEGORY_META, key: k, label: k })),
    ];

    return (
        <ExpensesListClient
            items={items}
            usersMap={usersMap}
            isGuest={isGuest}
            categories={filterCategories}
        />
    );
}
