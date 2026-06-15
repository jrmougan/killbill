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
        const interval = expense.recurringInterval;
        if (!interval) continue;

        const newNextDate = nextDate(expense.nextRecurringDate as Date, interval);

        // Create the new instance and advance the source date atomically, and guard
        // against concurrent invocations double-creating: the update is conditional on
        // nextRecurringDate still being the value we read, so only one runner wins.
        const result = await prisma.$transaction(async (tx) => {
            const advanced = await tx.expense.updateMany({
                where: { id: expense.id, nextRecurringDate: expense.nextRecurringDate as Date },
                data: { nextRecurringDate: newNextDate },
            });

            // Another concurrent run already advanced this expense — skip to avoid a duplicate.
            if (advanced.count === 0) return false;

            await tx.expense.create({
                data: {
                    description: expense.description,
                    amount: expense.amount,
                    category: expense.category,
                    paidById: expense.paidById,
                    coupleId: expense.coupleId,
                    notes: expense.notes ?? null,
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

            return true;
        });

        if (result) created++;
    }

    return NextResponse.json({ created });
}
