import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/currency';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { method, expenseIds } = body;

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: { couple: { include: { members: true } } }
    });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (settlement.fromUserId !== userId) {
        return NextResponse.json({ error: 'Only the creator can edit' }, { status: 403 });
    }

    try {
        // Simply update the settlement details
        // We no longer link expenses explicitly in the Running Balance model.
        await prisma.settlement.update({
            where: { id },
            data: {
                method: method || settlement.method,
                amount: body.amount !== undefined ? toCents(parseFloat(body.amount)) : settlement.amount,
                status: "PENDING" // Reset to pending if edited, requiring confirmation again
            }
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
}
