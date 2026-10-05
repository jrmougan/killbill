import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup, getGroupMembers } from "@/lib/membership";
import { redirect } from "next/navigation";
import { receiptItemsView, RECEIPT_LINES_SELECT } from "@/lib/receipt-read";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { APP_TZ } from "@/lib/home-format";
import { ExpenseForm, type AddSpace } from "@/components/expense/add/add-expense-client";
import { PERSONAL_SPACE } from "@/components/expenses/space-meta";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD of an instant in the app timezone (the day the user sees). */
function dayInAppTz(d: Date): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Editar gasto (G-11/T-07): the same numpad form as "Añadir gasto", hydrated
 * from the expense. Its space is fixed; date, amount, concept, category,
 * payer, split, receipt, tags, recurrence and notes are editable.
 */
export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const [expense, activeGroupId] = await Promise.all([
        prisma.expense.findUnique({
            where: { id },
            include: {
                splits: { select: { userId: true, amount: true } },
                tags: { select: { tagId: true } },
                series: true,
                ...RECEIPT_LINES_SELECT,
                ...CATEGORY_REF_SELECT,
            },
        }),
        getActiveGroup(userId),
    ]);

    if (!expense) redirect("/dashboard");

    const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];

    // Personal expenses are editable only by their owner; shared ones by members.
    const isPersonal = expense.visibility === "PERSONAL";
    const canEdit = isPersonal ? expense.ownerId === userId : members.some((m) => m.id === userId);
    if (!canEdit) redirect("/dashboard");

    // A SETTLING/ARCHIVED space is read-only — editing is blocked.
    const space = expense.coupleId
        ? await prisma.couple.findUnique({ where: { id: expense.coupleId }, select: { id: true, name: true, type: true, status: true } })
        : null;
    if (space && space.status !== "ACTIVE") redirect(`/expense/${id}`);

    // Tags of the EXPENSE's scope (G-07): the space's tags for a shared expense,
    // the owner's personal tags for a personal one — never the active space's.
    const tags = await prisma.tag.findMany({
        where: isPersonal ? { ownerId: userId, coupleId: null } : { coupleId: expense.coupleId! },
        select: { id: true, name: true, color: true, coupleId: true, ownerId: true },
        orderBy: { name: "asc" },
    });

    const spaces: AddSpace[] = space && !isPersonal
        ? [{
            id: space.id,
            name: space.name || "Espacio",
            type: space.type,
            members: members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar })),
        }]
        : [];

    const isTemplate = !!(expense.seriesId && expense.series?.templateId === expense.id);

    // Display meta of the CURRENT category, resolved in the expense's own context.
    const catMap = categoryMetaMap(await getEffectiveCategories(isPersonal ? { ownerId: userId } : { groupId: expense.coupleId! }));
    const currentKey = categoryKeyOf(expense);
    const currentMeta = catMap[currentKey] ?? { ...NEUTRAL_CATEGORY_META, label: currentKey };

    return (
        <ExpenseForm
            userId={userId}
            spaces={spaces}
            allowPersonal={isPersonal}
            activeGroupId={activeGroupId}
            initialSpace={isPersonal || !space ? PERSONAL_SPACE : space.id}
            tags={tags}
            initial={{
                expenseId: expense.id,
                amountCents: expense.amount,
                description: expense.description,
                category: currentKey,
                categoryMeta: { key: currentKey, label: currentMeta.label, emoji: currentMeta.emoji },
                date: dayInAppTz(expense.date),
                notes: expense.notes ?? "",
                tagIds: expense.tags.map((t) => t.tagId),
                isRecurring: isTemplate && !!expense.series?.isActive,
                recurringInterval: (expense.series?.interval as "weekly" | "monthly" | "yearly") ?? "monthly",
                paidById: expense.paidById,
                splitStrategy: expense.splitStrategy ?? null,
                splits: expense.splits,
                receiptItems: receiptItemsView(expense.lineItems),
                receiptUrl: expense.receiptUrl ?? null,
            }}
        />
    );
}
