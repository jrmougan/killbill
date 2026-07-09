import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPrimaryGroup, getGroupMembers } from "@/lib/membership";
import { redirect } from "next/navigation";
import { toEuros } from "@/lib/currency";
import { receiptItemsView, RECEIPT_LINES_SELECT } from "@/lib/receipt-read";
import { EditExpenseClient } from "./client";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Phase 4 selector switch: the caller's group comes from the Membership
    // layer (the expense's own couple.members include remains until the gated
    // User.coupleId / Couple.members contract drop).
    const [expense, groupId] = await Promise.all([
        prisma.expense.findUnique({
            where: { id },
            include: {
                splits: true,
                tags: { include: { tag: true } },
                series: true,
                ...RECEIPT_LINES_SELECT,
            },
        }),
        getPrimaryGroup(userId),
    ]);

    if (!expense) redirect("/dashboard");

    // Phase 5 (WS1): couple membership comes from the Membership layer, not the
    // expense.couple.members reverse relation.
    const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];

    // Personal expenses are editable only by their owner; shared ones by couple members.
    const isMember = members.some((m) => m.id === userId);
    const canEdit = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
    if (!canEdit) redirect("/dashboard");

    const allTags = groupId
        ? await prisma.tag.findMany({ where: { coupleId: groupId } })
        : [];

    const partner = members.find((m) => m.id !== userId) ?? null;

    // Detect initial split mode from current splits
    let initialSplitMode: "shared" | "solo" | "custom" = "shared";
    let initialMyPercent = 50;

    if (expense.splits.length === 1) {
        initialSplitMode = "solo";
        // A single split owned by the current user is a fully-mine expense (100%).
        const onlySplit = expense.splits[0];
        if (onlySplit.userId === userId && expense.amount > 0) {
            initialMyPercent = 100;
        }
    } else if (expense.splits.length === 2) {
        const [s1, s2] = expense.splits;
        const isEqual = Math.abs(s1.amount - s2.amount) <= 1;
        if (isEqual) {
            initialSplitMode = "shared";
        } else {
            initialSplitMode = "custom";
            const mySplit = expense.splits.find((s) => s.userId === userId);
            const partnerSplit = expense.splits.find((s) => s.userId !== userId);
            if (mySplit && expense.amount > 0) {
                initialMyPercent = Math.round((mySplit.amount / expense.amount) * 100);
            } else if (partnerSplit && expense.amount > 0) {
                initialMyPercent = 100 - Math.round((partnerSplit.amount / expense.amount) * 100);
            }
        }
    }

    return (
        <EditExpenseClient
            expenseId={id}
            userId={userId}
            partner={partner ? { id: partner.id, name: partner.name } : null}
            initialAmount={toEuros(expense.amount)}
            initialDescription={expense.description}
            initialCategory={expense.category}
            initialSplitMode={initialSplitMode}
            initialMyPercent={initialMyPercent}
            initialReceiptItems={receiptItemsView(expense.lineItems)}
            initialReceiptUrl={expense.receiptUrl ?? null}
            initialNotes={expense.notes ?? ""}
            initialIsRecurring={!!(expense.seriesId && expense.series?.templateId === expense.id && expense.series?.isActive)}
            initialRecurringInterval={(expense.series?.interval as "weekly" | "monthly" | "yearly") ?? "monthly"}
            initialTagIds={expense.tags.map((t) => t.tagId)}
            allTags={allTags}
            isPersonal={expense.visibility === "PERSONAL"}
        />
    );
}
