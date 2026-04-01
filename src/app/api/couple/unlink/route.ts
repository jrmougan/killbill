import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { coupleId: true }
        });

        if (!user?.coupleId) {
            return NextResponse.json({ error: 'No estás en ninguna pareja' }, { status: 400 });
        }

        const coupleId = user.coupleId;

        await prisma.$transaction(async (tx) => {
            // Unlink user inside transaction
            await tx.user.update({
                where: { id: userId },
                data: { coupleId: null }
            });

            // Count remaining members within the same transaction to avoid race condition
            const remainingMembers = await tx.user.count({
                where: { coupleId }
            });

            if (remainingMembers === 0) {
                // Delete in dependency order before removing the couple
                await tx.split.deleteMany({ where: { expense: { coupleId } } });
                await tx.expense.deleteMany({ where: { coupleId } });
                await tx.settlement.deleteMany({ where: { coupleId } });
                await tx.couple.delete({ where: { id: coupleId } });
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error unlinking couple:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
