import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup } from '@/lib/membership';

export async function POST(_request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    try {
        // Phase 4 selector switch: resolve my group via the Membership layer.
        // All coupleId writes below stay (dual-write) until the gated drop.
        const coupleId = await getActiveGroup(userId);

        if (!coupleId) {
            return NextResponse.json({ error: 'No estás en ningún grupo' }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            // Phase 5 (WS1 write-stop): the soft-leave of the Membership is the sole
            // state change (User.coupleId is no longer written). Preserve history;
            // never hard-delete. If the couple is torn down below, its memberships
            // cascade-delete.
            await tx.membership.updateMany({
                where: { groupId: coupleId, userId },
                data: { status: 'LEFT', leftAt: new Date() }
            });

            // Count remaining ACTIVE members (post soft-leave, so the leaver is
            // already excluded) within the same transaction to avoid a race.
            const remainingMembers = await tx.membership.count({
                where: { groupId: coupleId, status: 'ACTIVE' }
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
