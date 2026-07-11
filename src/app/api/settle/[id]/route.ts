import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { toCents } from '@/lib/currency';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = ctx.userId;

    const body = await request.json();
    const { method } = body;

    const settlement = await prisma.settlement.findUnique({ where: { id } });

    if (!settlement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Fase 1 security: this endpoint used to validate ONLY settlement.fromUserId
    // and never checked group membership. Authorize against the settlement's OWN
    // group (allowArchived: editing an amount is part of the settle/close flow).
    const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    if (settlement.fromUserId !== userId) {
        return NextResponse.json({ error: 'Only the creator can edit' }, { status: 403 });
    }

    if (settlement.status !== 'PENDING') {
        return NextResponse.json({ error: 'Only pending settlements can be edited' }, { status: 409 });
    }

    if (method !== undefined && !['CASH', 'BIZUM', 'TRANSFER'].includes(method)) {
        return NextResponse.json({ error: 'Invalid method' }, { status: 400 });
    }

    let nextAmount = settlement.amount;
    if (body.amount !== undefined) {
        const numericAmount = parseFloat(body.amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }
        nextAmount = toCents(numericAmount);
    }

    try {
        // Simply update the settlement details
        // We no longer link expenses explicitly in the Running Balance model.
        await prisma.settlement.update({
            where: { id },
            data: {
                method: method || settlement.method,
                amount: nextAmount,
                status: "PENDING" // Reset to pending if edited, requiring confirmation again
            }
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
}
