import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ExpensesListClient, type ListItem } from "./client";
import { getSession } from "@/lib/auth";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { NEUTRAL_CATEGORY_META, type CategoryBadgeMeta } from "@/components/category/category-badge";
import { spaceTitle } from "@/components/expenses/space-meta";

export const dynamic = "force-dynamic";

/**
 * Gastos (EQUIL `is.gastos`). Shared scope = the caller's active space
 * (expenses + settlements); `?scope=personal` — or having no space at all —
 * shows the private personal ledger instead. Amounts travel in cents.
 */
export default async function ExpensesListPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    const isGuest = session.kind === "guest";
    const { scope } = await searchParams;

    const groupId = scope === "personal" && !isGuest ? null : await getActiveGroup(userId);
    const personal = !groupId;

    const [space, members, catList] = await Promise.all([
        groupId ? prisma.couple.findUnique({ where: { id: groupId }, select: { name: true, type: true } }) : null,
        groupId ? getGroupMembers(groupId) : Promise.resolve([]),
        getEffectiveCategories(groupId ? { groupId } : { ownerId: userId }),
    ]);
    const catMap = categoryMetaMap(catList);
    const metaFor = (key: string): CategoryBadgeMeta => catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META;

    const [rawExpenses, rawSettlements] = await Promise.all([
        prisma.expense.findMany({
            where: personal ? { ownerId: userId, visibility: "PERSONAL" } : { coupleId: groupId!, visibility: "SHARED" },
            include: { splits: { select: { userId: true, amount: true } }, ...CATEGORY_REF_SELECT },
            orderBy: { date: "desc" },
        }),
        personal
            ? Promise.resolve([])
            : prisma.settlement.findMany({ where: { coupleId: groupId! }, orderBy: { date: "desc" } }),
    ]);

    const items: ListItem[] = [
        ...rawExpenses.map((e): ListItem => {
            const key = categoryKeyOf(e);
            return {
                id: e.id,
                type: "EXPENSE",
                description: e.description,
                amountCents: e.amount,
                date: e.date.toISOString(),
                category: key,
                categoryMeta: metaFor(key),
                paidBy: e.paidById,
                splitStrategy: e.splitStrategy ?? null,
                splits: e.splits,
            };
        }),
        ...rawSettlements.map((s): ListItem => ({
            id: s.id,
            type: "SETTLEMENT",
            description: "Liquidación",
            amountCents: s.amount,
            date: s.date.toISOString(),
            category: "settlement",
            paidBy: s.fromUserId,
            toUserId: s.toUserId,
            method: s.method,
            status: s.status,
        })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
            userId={userId}
            members={members.map((m) => ({ id: m.id, name: m.name }))}
            spaceLabel={spaceTitle(space)}
            personal={personal}
            isGuest={isGuest}
            categories={filterCategories}
        />
    );
}
