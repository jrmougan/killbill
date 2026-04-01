import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

function nextDate(base: Date, interval: string): Date {
    const next = new Date(base);
    if (interval === 'weekly') {
        next.setDate(next.getDate() + 7);
    } else if (interval === 'monthly') {
        next.setMonth(next.getMonth() + 1);
    } else if (interval === 'yearly') {
        next.setFullYear(next.getFullYear() + 1);
    }
    return next;
}

export async function POST() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

    const now = new Date();

    // Find all due recurring expenses for this couple
    const dueExpenses = await prisma.expense.findMany({
        where: {
            coupleId: user.coupleId,
            isRecurring: true,
            nextRecurringDate: { lte: now },
        },
        include: {
            splits: true,
        },
    });

    let created = 0;

    for (const expense of dueExpenses) {
        const interval = (expense as any).recurringInterval as string;
        if (!interval) continue;

        // Create new expense with same data, new date = today
        await prisma.expense.create({
            data: {
                description: expense.description,
                amount: expense.amount,
                category: expense.category,
                paidById: expense.paidById,
                coupleId: expense.coupleId,
                notes: (expense as any).notes ?? null,
                isRecurring: false, // new instance is not itself recurring
                splits: expense.splits.length > 0
                    ? {
                          create: expense.splits.map((s) => ({
                              userId: s.userId,
                              amount: s.amount,
                          })),
                      }
                    : undefined,
            },
        });

        // Advance nextRecurringDate on the original expense
        const newNextDate = nextDate((expense as any).nextRecurringDate as Date, interval);
        await prisma.expense.update({
            where: { id: expense.id },
            data: { nextRecurringDate: newNextDate },
        });

        created++;
    }

    return NextResponse.json({ created });
}
