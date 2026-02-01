import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { amount, toUserId, method, expenseIds } = body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });
    const coupleId = user.coupleId as string;

    await prisma.$transaction(async (tx) => {
        const settlement = await tx.settlement.create({
            data: {
                amount,
                fromUserId: userId,
                toUserId: (toUserId as string) || userId,
                coupleId: coupleId,
                method: method || "CASH" // CASH, BIZUM, etc.
            },
        });

        if (expenseIds && Array.isArray(expenseIds) && expenseIds.length > 0) {
            await tx.expense.updateMany({
                where: {
                    id: { in: expenseIds },
                    coupleId: coupleId // Security check
                },
                data: {
                    settlementId: settlement.id,
                    status: "SETTLED"
                }
            });
        }
    });

    return NextResponse.json({ success: true });
}
