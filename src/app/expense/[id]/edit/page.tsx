import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { toEuros } from "@/lib/currency";
import { ReceiptItem } from "@/types";
import { EditExpenseClient } from "./client";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const [expense, user] = await Promise.all([
        prisma.expense.findUnique({
            where: { id },
            include: {
                splits: true,
                couple: { include: { members: true } },
                tags: { include: { tag: true } },
            },
        }),
        prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!expense) redirect("/dashboard");

    const isMember = expense.couple.members.some((m) => m.id === userId);
    if (!isMember) redirect("/dashboard");

    const allTags = user?.coupleId
        ? await prisma.tag.findMany({ where: { coupleId: user.coupleId } })
        : [];

    const partner = expense.couple.members.find((m) => m.id !== userId) ?? null;

    // Detect initial split mode from current splits
    let initialSplitMode: "shared" | "solo" | "custom" = "shared";
    let initialMyPercent = 50;

    if (expense.splits.length === 1) {
        initialSplitMode = "solo";
    } else if (expense.splits.length === 2) {
        const [s1, s2] = expense.splits;
        const isEqual = Math.abs(s1.amount - s2.amount) <= 1;
        if (isEqual) {
            initialSplitMode = "shared";
        } else {
            initialSplitMode = "custom";
            const mySplit = expense.splits.find((s) => s.userId === userId);
            if (mySplit) {
                initialMyPercent = Math.round((mySplit.amount / expense.amount) * 100);
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
            initialReceiptItems={(expense.receiptData as unknown as ReceiptItem[]) ?? []}
            initialReceiptUrl={expense.receiptUrl ?? null}
            initialNotes={expense.notes ?? ""}
            initialIsRecurring={expense.isRecurring ?? false}
            initialRecurringInterval={(expense.recurringInterval as "weekly" | "monthly" | "yearly") ?? "monthly"}
            initialTagIds={expense.tags.map((t) => t.tagId)}
            allTags={allTags}
        />
    );
}
