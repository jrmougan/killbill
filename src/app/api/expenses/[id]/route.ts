import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const cookieStore = await cookies();
        const userId = cookieStore.get("user_id")?.value;

        if (!userId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

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
        const cookieStore = await cookies();
        const userId = cookieStore.get("user_id")?.value;

        if (!userId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

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
        const updatedExpense = await prisma.expense.update({
            where: { id },
            data: {
                description: description ?? expense.description,
                amount: amount ? parseFloat(amount) : expense.amount,
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
            const newAmount = amount ? parseFloat(amount) : expense.amount;
            if (splitWithPartner) {
                // 50/50 split
                await prisma.split.createMany({
                    data: members.map(m => ({
                        expenseId: id,
                        userId: m.id,
                        amount: newAmount / 2
                    }))
                });
            } else {
                // 100% for partner
                await prisma.split.create({
                    data: {
                        expenseId: id,
                        userId: partner.id,
                        amount: newAmount
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
