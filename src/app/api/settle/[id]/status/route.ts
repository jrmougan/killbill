import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { SettlementError } from '@/lib/settlement-rules';
import { resolveSettlement } from '@/lib/settlement-service';

/**
 * Confirm or reject a PENDING settlement as its RECEIVER (guests included: a
 * guest owed money confirming receipt only reduces the debt to them).
 *
 * Body: `{ status: 'CONFIRMED' | 'REJECTED', expectedAmountCents?: number }`.
 * `expectedAmountCents` is the amount the receiver saw: if the payer edited it
 * meanwhile → 409 SETTLEMENT_CHANGED (`amountCents` = current amount).
 *
 * Errors: 409 SETTLEMENT_NOT_PENDING (already confirmed/rejected),
 * SETTLEMENT_EXCEEDS_DEBT / NOTHING_TO_SETTLE (confirming would flip the debt),
 * SPACE_NOT_WRITABLE (ARCHIVED); 403 NOT_RECEIVER.
 * The transition is a conditional update under the space lock and the ledger is
 * posted only by the request that wins it.
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const ctx = await getSessionCtx();
        if (!ctx) return NextResponse.json({ error: 'No has iniciado sesión' }, { status: 401 });

        const body = await request.json().catch(() => null);
        const { status, expectedAmountCents } = (body ?? {}) as Record<string, unknown>;

        if (status !== 'CONFIRMED' && status !== 'REJECTED') {
            return NextResponse.json({ error: 'Estado no válido', code: 'INVALID_INPUT' }, { status: 400 });
        }
        if (expectedAmountCents !== undefined && !Number.isSafeInteger(expectedAmountCents)) {
            return NextResponse.json({ error: 'expectedAmountCents no válido', code: 'INVALID_INPUT' }, { status: 400 });
        }

        const settlement = await prisma.settlement.findUnique({ where: { id }, select: { coupleId: true } });
        if (!settlement) return NextResponse.json({ error: 'Pago no encontrado' }, { status: 404 });

        // Authorize against the settlement's OWN group (not the active-group cookie).
        const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

        const updated = await resolveSettlement({
            settlementId: id,
            groupId: settlement.coupleId,
            callerId: ctx.userId,
            status,
            expectedAmountCents: expectedAmountCents as number | undefined,
        });
        return NextResponse.json({ success: true, settlement: updated });
    } catch (e) {
        if (e instanceof SettlementError) return NextResponse.json(e.toJSON(), { status: e.status });
        console.error('Error al actualizar el pago:', e);
        return NextResponse.json({ error: 'No se pudo actualizar el pago' }, { status: 500 });
    }
}
