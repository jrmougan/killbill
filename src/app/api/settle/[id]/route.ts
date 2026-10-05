import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { isSettlementMethod, parseSettlementAmount, SettlementError } from '@/lib/settlement-rules';
import { editSettlement } from '@/lib/settlement-service';

/**
 * Edit a PENDING settlement (payer only — guests included: it is their own
 * unconfirmed payment). Body: `{ amount?: number (euros), method? }`.
 *
 * The update is conditional on `status = PENDING` under the space lock, so it
 * can never race a confirm/reject into a "PENDING again with another amount"
 * state: once confirmed/rejected the edit gets 409 SETTLEMENT_NOT_PENDING.
 * ARCHIVED spaces → 409 SPACE_NOT_WRITABLE; amount above the current debt →
 * 409 SETTLEMENT_EXCEEDS_DEBT.
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
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json({ error: 'Petición no válida', code: 'INVALID_INPUT' }, { status: 400 });
        }
        const { method, amount } = body as Record<string, unknown>;

        if (method !== undefined && !isSettlementMethod(method)) {
            return NextResponse.json({ error: 'Método de pago no válido', code: 'INVALID_INPUT' }, { status: 400 });
        }
        let cents: number | undefined;
        if (amount !== undefined) {
            const parsed = parseSettlementAmount(amount);
            if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'INVALID_AMOUNT' }, { status: 400 });
            cents = parsed.cents;
        }

        const settlement = await prisma.settlement.findUnique({ where: { id }, select: { coupleId: true } });
        if (!settlement) return NextResponse.json({ error: 'Pago no encontrado' }, { status: 404 });

        // Authorize against the settlement's OWN group.
        const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

        const updated = await editSettlement({
            settlementId: id,
            groupId: settlement.coupleId,
            callerId: ctx.userId,
            cents,
            method: isSettlementMethod(method) ? method : undefined,
        });
        return NextResponse.json({
            success: true,
            settlement: { id: updated.id, status: updated.status, amount: updated.amount, method: updated.method },
        });
    } catch (e) {
        if (e instanceof SettlementError) return NextResponse.json(e.toJSON(), { status: e.status });
        console.error('Error al editar el pago:', e);
        return NextResponse.json({ error: 'No se pudo guardar el pago' }, { status: 500 });
    }
}
