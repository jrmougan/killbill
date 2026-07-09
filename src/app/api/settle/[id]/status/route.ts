import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup } from '@/lib/membership';
import { postSettlementLedger } from '@/lib/ledger';

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

    // Enforce Couple Context (Phase 4 selector switch: Membership layer).
    const groupId = await getPrimaryGroup(userId);

    if (settlement.coupleId !== groupId) {
        return NextResponse.json({ error: 'Settlement does not belong to your couple' }, { status: 403 });
    }

    if (settlement.toUserId !== userId) {
        return NextResponse.json({ error: 'Only the receiver can update status' }, { status: 403 });
    }

    // Enforce valid status transitions. Only a PENDING settlement may be acted
    // upon (CONFIRMED or REJECTED). Reverting a resolved settlement back to
    // PENDING, or any other transition, is not allowed.
    const allowedTransitions: Record<string, string[]> = {
        PENDING: ["CONFIRMED", "REJECTED"],
    };

    if (!allowedTransitions[settlement.status]?.includes(status)) {
        return NextResponse.json(
            { error: `Invalid status transition from ${settlement.status} to ${status}` },
            { status: 400 }
        );
    }

    try {
        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.settlement.update({
                where: { id },
                data: { status }
            });
            // Phase 3 dual-write: PENDING->CONFIRMED is the moment the settlement
            // enters the balance, so post its ledger transaction here. REJECTED
            // posts nothing (representation-by-absence), matching
            // effectiveSettlements = status === 'CONFIRMED' in finance/dashboard.
            if (status === 'CONFIRMED') {
                await postSettlementLedger(tx, {
                    id: u.id,
                    coupleId: u.coupleId,
                    amount: u.amount,
                    fromUserId: u.fromUserId,
                    toUserId: u.toUserId,
                    date: u.date,
                });
            }
            return u;
        });
        return NextResponse.json({ success: true, settlement: updated });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
}
