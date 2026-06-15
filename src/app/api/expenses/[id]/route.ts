import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { toCents } from "@/lib/currency";
import { calculateSplitAmounts } from "@/lib/splits";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { couple: { include: { members: true } } }
        });

        if (!expense) {
            return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
        }

        // Check if user is part of the couple
        const isMember = expense.couple.members.some(m => m.id === userId);
        if (!isMember) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        // Delete expense (splits will cascade delete)
        await prisma.expense.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting expense:", error);
        return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { description, amount, category, splitWithPartner, receiptItems, notes, isRecurring, recurringInterval, customSplits } = body;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { couple: { include: { members: true } } }
        });

        if (!expense) {
            return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
        }

        // Check if user is part of the couple
        const isMember = expense.couple.members.some(m => m.id === userId);
        if (!isMember) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        const members = expense.couple.members;
        const partner = members.find(m => m.id !== expense.paidById);

        // Update expense
        const amountCents = amount ? toCents(parseFloat(amount)) : expense.amount;
        if (amount !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        // Validate that client-supplied splits sum exactly to the expense amount.
        if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
            const splitsTotal = customSplits.reduce(
                (sum: number, s: { amount: number }) => sum + (s?.amount ?? 0),
                0
            );
            if (splitsTotal !== amountCents) {
                return NextResponse.json({ error: 'Splits must sum to the total amount' }, { status: 400 });
            }
        }

        // Recalculate nextRecurringDate if recurring settings changed
        const resolvedIsRecurring = isRecurring ?? (expense as any).isRecurring;
        const resolvedInterval = recurringInterval !== undefined ? recurringInterval : (expense as any).recurringInterval;
        let nextRecurringDate: Date | null | undefined = undefined;
        if (isRecurring !== undefined || recurringInterval !== undefined) {
            if (resolvedIsRecurring && resolvedInterval) {
                const base = new Date();
                if (resolvedInterval === 'weekly') {
                    nextRecurringDate = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
                } else if (resolvedInterval === 'monthly') {
                    nextRecurringDate = new Date(base);
                    nextRecurringDate.setMonth(nextRecurringDate.getMonth() + 1);
                } else if (resolvedInterval === 'yearly') {
                    nextRecurringDate = new Date(base);
                    nextRecurringDate.setFullYear(nextRecurringDate.getFullYear() + 1);
                }
            } else {
                nextRecurringDate = null;
            }
        }

        const updateData: any = {
            description: description ?? expense.description,
            amount: amountCents,
            category: category ?? expense.category,
            receiptData: receiptItems ?? expense.receiptData,
        };
        if (notes !== undefined) updateData.notes = notes;
        if (isRecurring !== undefined) updateData.isRecurring = isRecurring;
        if (recurringInterval !== undefined) updateData.recurringInterval = recurringInterval;
        if (nextRecurringDate !== undefined) updateData.nextRecurringDate = nextRecurringDate;

        // Recalculate splits if split mode changed, amount changed, receiptItems changed, or customSplits provided
        const shouldRecalcSplits = splitWithPartner !== undefined || amount !== undefined || receiptItems !== undefined || customSplits !== undefined;

        // Determine the existing split mode BEFORE deleting anything — otherwise the
        // count is always 0 and an amount-only edit silently collapses a 50/50 split.
        let isSplitWithPartner = false;
        if (shouldRecalcSplits && partner && !(customSplits && Array.isArray(customSplits) && customSplits.length > 0)) {
            const existingSplits = await prisma.split.findMany({ where: { expenseId: id } });
            isSplitWithPartner = splitWithPartner !== undefined
                ? splitWithPartner
                : existingSplits.length === 2;
        }

        // Update the expense and rewrite its splits atomically so a failure mid-way
        // can never leave the expense updated with stale/orphaned splits.
        const updatedExpense = await prisma.$transaction(async (tx) => {
            const updated = await tx.expense.update({
                where: { id },
                data: updateData,
            });

            if (shouldRecalcSplits && partner) {
                await tx.split.deleteMany({ where: { expenseId: id } });

                if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
                    await tx.split.createMany({
                        data: customSplits.map((s: { userId: string; amount: number }) => ({
                            expenseId: id,
                            userId: s.userId,
                            amount: s.amount,
                        }))
                    });
                } else if (isSplitWithPartner) {
                    const currentReceiptData = receiptItems ?? (expense.receiptData as any[] | null);
                    const splits = calculateSplitAmounts(amountCents, currentReceiptData, members);
                    await tx.split.createMany({
                        data: splits.map(s => ({ expenseId: id, userId: s.userId, amount: s.amount }))
                    });
                } else {
                    await tx.split.create({
                        data: { expenseId: id, userId: partner.id, amount: amountCents }
                    });
                }
            }

            return updated;
        });

        return NextResponse.json({ success: true, expense: updatedExpense });
    } catch (error) {
        console.error("Error updating expense:", error);
        return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
    }
}
