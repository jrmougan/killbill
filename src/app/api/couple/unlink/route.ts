import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup, getMembership } from '@/lib/membership';

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    try {
        // F4 (multi-group): accept an optional { groupId } and leave THAT group.
        // Parse defensively — an empty body must not 500.
        let bodyGroupId: string | null = null;
        try {
            const b = await request.json();
            if (b && typeof b.groupId === 'string') bodyGroupId = b.groupId;
        } catch { /* no body — fall back to the active group below */ }

        // Resolve the target group. Explicit path: validate the caller has an
        // ACTIVE membership in it. Fallback path (no groupId): the active group,
        // whose resolver re-checks membership itself. Either way we never leave a
        // group the user isn't an ACTIVE member of.
        let coupleId: string | null;
        if (bodyGroupId) {
            const m = await getMembership(bodyGroupId, userId);
            if (!m || m.status !== 'ACTIVE') {
                return NextResponse.json({ error: 'No perteneces a este grupo' }, { status: 403 });
            }
            coupleId = bodyGroupId;
        } else {
            // Backward-compatible: resolve my group via the Membership layer.
            coupleId = await getActiveGroup(userId);
        }

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
