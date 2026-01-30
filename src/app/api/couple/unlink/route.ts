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

        // Unlink user
        await prisma.user.update({
            where: { id: userId },
            data: { coupleId: null }
        });

        // Optional: If the couple is now empty, delete it?
        // Let's check how many members are left
        const remainingMembers = await prisma.user.count({
            where: { coupleId: user.coupleId }
        });

        if (remainingMembers === 0) {
            // Delete expenses, settlements, and couple to avoid trash
            // Order is important due to relations
            await prisma.split.deleteMany({ where: { expense: { coupleId: user.coupleId } } });
            await prisma.expense.deleteMany({ where: { coupleId: user.coupleId } });
            await prisma.settlement.deleteMany({ where: { coupleId: user.coupleId } });
            await prisma.couple.delete({ where: { id: user.coupleId } });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error unlinking couple:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
