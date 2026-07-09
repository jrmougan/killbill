import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup } from '@/lib/membership';

export async function POST(_request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    try {
        // Phase 4 selector switch: resolve my group via the Membership layer.
        // All coupleId writes below stay (dual-write) until the gated drop.
        const coupleId = await getPrimaryGroup(userId);

        if (!coupleId) {
            return NextResponse.json({ error: 'No estás en ninguna pareja' }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            // Unlink user inside transaction
            await tx.user.update({
                where: { id: userId },
                data: { coupleId: null }
            });

            // Soft-leave the membership (preserve history; never hard-delete).
            // If the couple is torn down below, its memberships cascade-delete.
            await tx.membership.updateMany({
                where: { groupId: coupleId, userId },
                data: { status: 'LEFT', leftAt: new Date() }
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
