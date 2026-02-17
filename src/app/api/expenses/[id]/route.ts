import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { toCents } from "@/lib/currency";

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
        const { description, amount, category, splitWithPartner, receiptItems } = body;

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
        const updatedExpense = await prisma.expense.update({
            where: { id },
            data: {
                description: description ?? expense.description,
                amount: amountCents,
                category: category ?? expense.category,
                receiptData: receiptItems ?? expense.receiptData,
            }
        });

        // If split changed, update splits
        if (splitWithPartner !== undefined && partner) {
            // Delete existing splits
            await prisma.split.deleteMany({
                where: { expenseId: id }
            });

            // Create new splits
            if (splitWithPartner) {
                // 50/50 split with floor+remainder to avoid over-counting
                const baseAmount = Math.floor(amountCents / 2);
                const remainder = amountCents - (baseAmount * 2);
                await prisma.split.createMany({
                    data: members.map((m: any, i: number) => ({
                        expenseId: id,
                        userId: m.id,
                        amount: baseAmount + (i < remainder ? 1 : 0)
                    }))
                });
            } else {
                // 100% for partner
                await prisma.split.create({
                    data: {
                        expenseId: id,
                        userId: partner.id,
                        amount: amountCents
                    }
                });
            }
        }

        return NextResponse.json({ success: true, expense: updatedExpense });
    } catch (error) {
        console.error("Error updating expense:", error);
        return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
    }
}
