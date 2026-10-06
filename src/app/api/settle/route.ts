import { NextResponse } from 'next/server';
import { getActiveGroup, getGroupMembers } from '@/lib/membership';
import { badRequest, forbidden, requireSpace, route } from '@/lib/http';
import { CreateSettlementBody, parseSettlementInput } from '@/lib/settlement-schemas';
import { createSettlement } from '@/lib/settlement-service';

const bad = (error: string, code = 'INVALID_INPUT') => badRequest(error, code);

/**
 * Record a settlement in a space.
 *
 * Two directions (EQUIL "Quedar en paz", see docs/design/README.md → Settle):
 *
 * - **Paid** (default, `{ toUserId }`): the caller says "Ya he pagado". The
 *   settlement is created PENDING (caller → toUserId) and only enters the balance
 *   when the receiver confirms it via /api/settle/[id]/status.
 *
 * - **Received** (`{ fromUserId }`): the caller is the CREDITOR and says "Ya me
 *   ha pagado". The settlement (fromUserId → caller) is created CONFIRMED and its
 *   ledger transaction posted in the same DB transaction. If the debtor already
 *   registered a PENDING for the same amount, that one is confirmed instead
 *   (`merged: true`) so the payment is never counted twice.
 *
 * Body: `{ amount: number (euros, > 0, ≤ 1.000.000), toUserId | fromUserId,
 * method?: 'CASH'|'BIZUM'|'TRANSFER', groupId?: string }`. The space is
 * `groupId` (authorized against that space) or the caller's active group.
 * Response: `{ success, settlement: { id, status, amount (cents) }, merged }`.
 * Rule failures are `{ error, code }` (see settlement-service.ts): 409
 * SPACE_NOT_WRITABLE / SETTLEMENT_EXCEEDS_DEBT / NOTHING_TO_SETTLE /
 * SETTLEMENT_PENDING_EXISTS.
 *
 * Guests may use both directions: "received" can only ever reduce what is owed
 * to the guest, and it is capped to the current debt.
 */
export const POST = route(
    {
        auth: 'user-or-guest',
        unauthorizedMessage: 'No has iniciado sesión',
        errorMessage: 'Error al registrar el pago',
        logLabel: 'Error al registrar el pago:',
    },
    async ({ req, ctx }) => {
        const userId = ctx.userId;
        // Parsed in the handler (not options.body) so every 400 keeps its `code`.
        const { amount: cents, toUserId, fromUserId, method, groupId } = await parseSettlementInput(req, CreateSettlementBody);

        const received = fromUserId != null;
        if (received) {
            if (toUserId !== undefined && toUserId !== null && toUserId !== userId) {
                throw bad('Un pago recibido debe ir dirigido a ti');
            }
            if (fromUserId === userId) throw bad('No puedes saldar contigo mismo');
        } else if (toUserId === userId) {
            throw bad('No puedes saldar contigo mismo');
        }
        const counterpartyId = (received ? fromUserId : toUserId) as string;

        const coupleId = groupId || (await getActiveGroup(userId));
        if (!coupleId) throw bad('No tienes ningún espacio compartido activo', 'NO_SPACE');

        // Authorize against the space itself (DB membership, not the JWT claim).
        // The ARCHIVED check happens under the space lock in the service.
        await requireSpace(ctx, coupleId, { allowArchived: true, allowGuest: true });

        const members = await getGroupMembers(coupleId);
        if (!members.some((m) => m.id === counterpartyId)) {
            throw forbidden('La otra persona no es miembro de este espacio');
        }

        const result = await createSettlement({
            groupId: coupleId,
            callerId: userId,
            counterpartyId,
            direction: received ? 'received' : 'paid',
            cents,
            method: method ?? 'CASH',
        });

        return NextResponse.json({
            success: true,
            settlement: { id: result.id, status: result.status, amount: result.amount },
            merged: result.merged,
        });
    },
);
