import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.activeGroupId) return NextResponse.json({ expenses: [] });

    const expenses = await prisma.expense.findMany({
        where: { groupId: user.activeGroupId },
        include: {
            paidBy: {
                select: { name: true }
            }
        },
        orderBy: { date: 'desc' },
    });

    const mappedExpenses = expenses.map((e: any) => ({
        ...e,
        payer_name: e.paidBy.name
    }));

    return NextResponse.json({ expenses: mappedExpenses });
}

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { description, amount, category, beneficiaryId } = body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.activeGroupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    const expenseData: any = {
        description,
        amount,
        category,
        paidById: userId,
        groupId: user.activeGroupId,
    };

    if (beneficiaryId) {
        expenseData.splits = {
            create: [
                {
                    userId: beneficiaryId,
                    amount: amount
                }
            ]
        };
    } else {
        // Split among all group members
        const groupMembers = await prisma.userGroup.findMany({
            where: { groupId: user.activeGroupId },
            select: { userId: true }
        });

        if (groupMembers.length > 0) {
            const splitAmount = amount / groupMembers.length;
            expenseData.splits = {
                create: groupMembers.map((m: any) => ({
                    userId: m.userId,
                    amount: splitAmount
                }))
            };
        }
    }

    const expense = await prisma.expense.create({
        // @ts-ignore - Prisma types might be stale
        data: expenseData
    });

    return NextResponse.json({ success: true, expenseId: expense.id });
}
