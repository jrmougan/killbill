import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { amount, toUserId, method } = body;

    if (!toUserId) return NextResponse.json({ error: 'toUserId is required' }, { status: 400 });
    if (toUserId === userId) return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });
    const coupleId = user.coupleId as string;

    await prisma.$transaction(async (tx) => {
        await tx.settlement.create({
            data: {
                amount: toCents(amount),
                fromUserId: userId,
                toUserId: toUserId as string,
                coupleId: coupleId,
                method: method || "CASH"
            },
        });
    });

    return NextResponse.json({ success: true });
}
