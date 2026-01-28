import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { status } = body;

    if (!["CONFIRMED", "REJECTED", "PENDING"].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const settlement = await prisma.settlement.findUnique({
        where: { id },
    });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Enforce Couple Context
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (settlement.coupleId !== user?.coupleId) {
        return NextResponse.json({ error: 'Settlement does not belong to your couple' }, { status: 403 });
    }

    if (settlement.toUserId !== userId) {
        return NextResponse.json({ error: 'Only the receiver can update status' }, { status: 403 });
    }

    try {
        const updated = await prisma.settlement.update({
            where: { id },
            data: { status }
        });
        return NextResponse.json({ success: true, settlement: updated });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
}
