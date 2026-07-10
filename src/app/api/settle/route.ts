import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup, getGroupMembers } from '@/lib/membership';
import { toCents } from '@/lib/currency';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { amount, toUserId, method } = body;

        if (!toUserId) return NextResponse.json({ error: 'toUserId is required' }, { status: 400 });
        if (toUserId === userId) return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });

        const numericAmount = Number(amount);
        // amount === 0 is allowed: it records a "checkpoint" settlement used to
        // archive/clear the pending list when there are no outstanding debts.
        if (!Number.isFinite(numericAmount) || numericAmount < 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        if (method !== undefined && !['CASH', 'BIZUM', 'TRANSFER'].includes(method)) {
            return NextResponse.json({ error: 'Invalid method' }, { status: 400 });
        }

        // Phase 4 selector switch: group + members come from the Membership layer
        // (was user.coupleId + couple.members include).
        const coupleId = await getActiveGroup(userId);
        if (!coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        const members = await getGroupMembers(coupleId);
        const isMember = members.some((m) => m.id === toUserId);
        if (!isMember) {
            return NextResponse.json({ error: 'toUserId is not a member of your couple' }, { status: 403 });
        }

        await prisma.$transaction(async (tx) => {
            await tx.settlement.create({
                data: {
                    amount: toCents(numericAmount),
                    fromUserId: userId,
                    toUserId: toUserId as string,
                    coupleId: coupleId,
                    method: method || "CASH"
                },
            });
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error al registrar el pago:', error);
        return NextResponse.json({ error: 'Error al registrar el pago' }, { status: 500 });
    }
}
