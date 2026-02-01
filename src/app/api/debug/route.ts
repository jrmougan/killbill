import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { calculateBalances } from "@/lib/finance";

export async function GET() {
    // Get all expenses
    const expenses = await prisma.expense.findMany({
        include: { splits: true },
        orderBy: { date: "desc" },
        take: 20
    });

    // Get all settlements
    const settlements = await prisma.settlement.findMany({
        orderBy: { date: "desc" }
    });

    // Get users
    const users = await prisma.user.findMany({
        select: { id: true, name: true }
    });

    // Calculate balances
    const balances = calculateBalances(
        users,
        expenses.map(e => ({
            paidById: e.paidById,
            amount: e.amount,
            splits: e.splits.map(s => ({
                userId: s.userId,
                amount: s.amount
            }))
        })),
        settlements,
        users[0]?.id || ""
    );

    return NextResponse.json({
        expenses: expenses.map(e => ({
            id: e.id,
            description: e.description,
            amount: e.amount,
            splits: e.splits.map(s => ({ userId: s.userId, amount: s.amount }))
        })),
        settlements: settlements.map(s => ({
            id: s.id,
            amount: s.amount,
            from: s.fromUserId,
            to: s.toUserId
        })),
        balances,
        users
    });
}
