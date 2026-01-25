import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { amount, toUserId, method } = body;

    // Simplification: We don't link settlements to specific expenses anymore.
    // It is just a transfer of value between users.

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.groupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    await prisma.settlement.create({
        data: {
            amount,
            fromUserId: userId,
            toUserId: toUserId || userId,
            groupId: user.groupId,
            method: method || "CASH" // CASH, BIZUM, etc.
        },
    });

    return NextResponse.json({ success: true });
}
