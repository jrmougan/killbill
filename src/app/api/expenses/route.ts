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

    if (!user?.coupleId) return NextResponse.json({ expenses: [] });

    const expenses = await prisma.expense.findMany({
        where: { coupleId: user.coupleId },
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

    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const expenseData: any = {
        description,
        amount,
        category,
        paidById: userId,
        coupleId: user.coupleId,
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
        // Split among couple members (max 2)
        const coupleMembers = await prisma.user.findMany({
            where: { coupleId: user.coupleId },
            select: { id: true }
        });

        if (coupleMembers.length > 0) {
            const splitAmount = amount / coupleMembers.length;
            expenseData.splits = {
                create: coupleMembers.map((m: any) => ({
                    userId: m.id,
                    amount: splitAmount
                }))
            };
        }
    }

    const expense = await prisma.expense.create({
        data: expenseData
    });

    return NextResponse.json({ success: true, expenseId: expense.id });
}
