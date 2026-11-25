import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { notFound, requireSpace, route } from '@/lib/http';
import { idParams } from '@/lib/http/schemas';
import { parseSettlementInput, ResolveSettlementBody } from '@/lib/settlement-schemas';
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
export const PATCH = route(
    {
        auth: 'user-or-guest',
        params: idParams,
        unauthorizedMessage: 'No has iniciado sesión',
        errorMessage: 'No se pudo actualizar el pago',
        logLabel: 'Error al actualizar el pago:',
    },
    async ({ req, ctx, params: { id } }) => {
        // Parsed in the handler (not options.body) so every 400 keeps its `code`.
        const { status, expectedAmountCents } = await parseSettlementInput(req, ResolveSettlementBody);

        const settlement = await prisma.settlement.findUnique({ where: { id }, select: { coupleId: true } });
        if (!settlement) throw notFound('Pago no encontrado');

        // Authorize against the settlement's OWN group (not the active-group cookie).
        await requireSpace(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });

        const updated = await resolveSettlement({
            settlementId: id,
            groupId: settlement.coupleId,
            callerId: ctx.userId,
            status,
            expectedAmountCents,
        });
        return NextResponse.json({ success: true, settlement: updated });
    },
);
