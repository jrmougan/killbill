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

    if (!user?.groupId) return NextResponse.json({ expenses: [] });

    const expenses = await prisma.expense.findMany({
        where: { groupId: user.groupId },
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
    const { description, amount, category } = body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.groupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    const expense = await prisma.expense.create({
        data: {
            description,
            amount,
            category,
            paidById: userId,
            groupId: user.groupId,
        },
    });

    return NextResponse.json({ success: true, expenseId: expense.id });
}
