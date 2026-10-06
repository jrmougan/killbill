import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { notFound, requireSpace, route } from '@/lib/http';
import { idParams } from '@/lib/http/schemas';
import { EditSettlementBody, parseSettlementInput } from '@/lib/settlement-schemas';
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
export const PATCH = route(
    {
        auth: 'user-or-guest',
        params: idParams,
        unauthorizedMessage: 'No has iniciado sesión',
        errorMessage: 'No se pudo guardar el pago',
        logLabel: 'Error al editar el pago:',
    },
    async ({ req, ctx, params: { id } }) => {
        // Parsed in the handler (not options.body) so every 400 keeps its `code`.
        const { amount: cents, method } = await parseSettlementInput(req, EditSettlementBody);

        const settlement = await prisma.settlement.findUnique({ where: { id }, select: { coupleId: true } });
        if (!settlement) throw notFound('Pago no encontrado');

        // Authorize against the settlement's OWN group.
        await requireSpace(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });

        const updated = await editSettlement({
            settlementId: id,
            groupId: settlement.coupleId,
            callerId: ctx.userId,
            cents,
            method,
        });
        return NextResponse.json({
            success: true,
            settlement: { id: updated.id, status: updated.status, amount: updated.amount, method: updated.method },
        });
    },
);
