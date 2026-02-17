import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';
import { calculateSplitAmounts } from '@/lib/splits';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

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
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { description, amount, category, beneficiaryId, receiptUrl, receiptData } = body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    // Convert euros to cents
    const amountCents = toCents(amount);

    const expenseData: any = {
        description,
        amount: amountCents,
        category,
        paidById: userId,
        coupleId: user.coupleId,
        receiptUrl: receiptUrl || null,
        receiptData: receiptData || undefined, // Prisma Json handling
    };

    if (beneficiaryId) {
        expenseData.splits = {
            create: [
                {
                    userId: beneficiaryId,
                    amount: amountCents
                }
            ]
        };
    } else {
        // Split among couple members, accounting for exclusive items
        const coupleMembers = await prisma.user.findMany({
            where: { coupleId: user.coupleId },
            select: { id: true }
        });

        if (coupleMembers.length > 0) {
            const splits = calculateSplitAmounts(amountCents, receiptData, coupleMembers);
            expenseData.splits = {
                create: splits.map(s => ({
                    userId: s.userId,
                    amount: s.amount,
                }))
            };
        }
    }

    const expense = await prisma.expense.create({
        data: expenseData
    });

    return NextResponse.json({ success: true, expenseId: expense.id });
}
