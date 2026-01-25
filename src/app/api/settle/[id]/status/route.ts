import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> } // params is distinct from the request
) {
    const { id } = await params;
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { status } = body;

    if (!["CONFIRMED", "REJECTED", "PENDING"].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Verify User is the Receiver (only receiver can confirm/reject)
    // Or Sender can cancel if PENDING? For now, simplistic rule: Receiver controls status.
    const settlement = await prisma.settlement.findUnique({
        where: { id }
    });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
