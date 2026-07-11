import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { postSettlementLedger } from '@/lib/ledger';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = ctx.userId;

    const body = await request.json();
    const { status } = body;

    if (!["CONFIRMED", "REJECTED", "PENDING"].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const settlement = await prisma.settlement.findUnique({
        where: { id },
    });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Authorize against the settlement's OWN group (not the active-group cookie):
    // confirming a settlement from a SETTLING/ARCHIVED space must not 403 in
    // multi-group. Settling is permitted while the space is closing/archived.
    const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

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
