import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';
import { CATEGORIES } from '@/lib/categories';

const VALID_CATEGORIES = Object.keys(CATEGORIES);

export async function GET() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ budgets: [] });

    // Current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const budgets = await prisma.budget.findMany({
        where: {
            coupleId: user.coupleId,
            month: monthStart,
        },
        orderBy: { category: 'asc' },
    });

    // Get actual spending per category for the current month
    const expenses = await prisma.expense.findMany({
        where: {
            coupleId: user.coupleId,
            date: { gte: monthStart, lt: monthEnd },
        },
        select: { category: true, amount: true },
    });

    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
        spentByCategory[e.category] = (spentByCategory[e.category] ?? 0) + e.amount;
    }

    const result = budgets.map((budget) => {
        const spent = spentByCategory[budget.category] ?? 0;
        const percentage = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
        return { budget, spent, percentage };
    });

    return NextResponse.json({ budgets: result });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        const body = await request.json();
        const { category, amount, month } = body;

        if (!category || amount === undefined) {
            return NextResponse.json({ error: 'category and amount are required' }, { status: 400 });
        }

        if (!VALID_CATEGORIES.includes(category)) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }

        // Parse month (YYYY-MM) or default to current month
        let monthDate: Date;
        if (month) {
            const [year, mon] = month.split('-').map(Number);
            monthDate = new Date(year, mon - 1, 1);
        } else {
            const now = new Date();
            monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const amountNum = Number(amount);
        if (!Number.isFinite(amountNum)) {
            return NextResponse.json({ error: 'amount must be a valid number' }, { status: 400 });
        }

        const amountCents = toCents(amountNum);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
            return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
        }

        const budget = await prisma.budget.upsert({
            where: {
                category_month_coupleId: {
                    category,
                    month: monthDate,
                    coupleId: user.coupleId,
                },
            },
            create: {
                category,
                amount: amountCents,
                month: monthDate,
                coupleId: user.coupleId,
            },
            update: {
                amount: amountCents,
            },
        });

        return NextResponse.json({ budget }, { status: 201 });
    } catch (error) {
        console.error('Error al guardar el presupuesto:', error);
        return NextResponse.json({ error: 'Error al guardar el presupuesto' }, { status: 500 });
    }
}
