import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { calculateSplitAmounts, hasExclusiveReceiptItems, type ReceiptItemForSplit } from "@/lib/splits";
import { addInterval } from "@/lib/recurring";
import { getGroupMembers, getPrimaryGroup } from "@/lib/membership";
import { postExpenseLedger } from "@/lib/ledger";

/**
 * Promote a personal expense to a shared (couple) expense.
 *
 * Only the owner can share, and only if they belong to a couple. The expense
 * gains a coupleId, flips visibility to SHARED, and receives the split records
 * (equal / receipt-aware) so it starts counting towards the couple's balances.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        // Phase 4 selector switch: the caller's group comes from the Membership layer.
        const groupId = await getPrimaryGroup(userId);
        if (!groupId) {
            return NextResponse.json({ error: 'Necesitas una pareja para compartir un gasto' }, { status: 400 });
        }

        const expense = await prisma.expense.findUnique({ where: { id } });
        if (!expense) {
            return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
        }

        // Only the owner of a personal expense can share it.
        if (expense.ownerId !== userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }
        if (expense.visibility === 'SHARED') {
            return NextResponse.json({ error: 'El gasto ya es compartido' }, { status: 409 });
        }

        const coupleMembers = (await getGroupMembers(groupId)).map((m) => ({ id: m.id }));

        const splits = calculateSplitAmounts(
            expense.amount,
            expense.receiptData as ReceiptItemForSplit[] | null,
            coupleMembers,
        );

        // If it was a personal recurring expense, its nextRecurringDate has been
        // drifting in the past (the personal runner may not have caught up). Reset
        // it to the next FUTURE occurrence so sharing doesn't trigger a catch-up
        // burst of backdated shared expenses on the next couple dashboard load.
        let nextRecurringDate: Date | undefined;
        if (expense.isRecurring && expense.recurringInterval) {
            nextRecurringDate = addInterval(new Date(), expense.recurringInterval);
        }

        // Flip to shared, attach to the couple, and create the splits atomically.
        await prisma.$transaction(async (tx) => {
            await tx.split.deleteMany({ where: { expenseId: id } });
            const updated = await tx.expense.update({
                where: { id },
                data: {
                    visibility: 'SHARED',
                    coupleId: groupId,
                    splitStrategy: hasExclusiveReceiptItems(expense.receiptData) ? 'ITEMIZED' : 'EQUAL',
                    ...(nextRecurringDate ? { nextRecurringDate } : {}),
                    splits: {
                        create: splits.map(s => ({ userId: s.userId, amount: s.amount })),
                    },
                },
            });

            // Phase 4: promotion to SHARED enters the couple balance — post its
            // ledger transaction so a shared expense is never left with zero entries.
            await postExpenseLedger(tx, {
                expenseId: id,
                groupId,
                amount: updated.amount,
                paidById: updated.paidById,
                occurredAt: updated.date,
                splits: splits.map(s => ({ userId: s.userId, amount: s.amount })),
                members: coupleMembers,
            });
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error sharing expense:", error);
        return NextResponse.json({ error: "Error al compartir el gasto" }, { status: 500 });
    }
}
