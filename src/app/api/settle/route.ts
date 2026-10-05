import { NextResponse } from 'next/server';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { getActiveGroup, getGroupMembers } from '@/lib/membership';
import { isSettlementMethod, parseSettlementAmount, SettlementError } from '@/lib/settlement-rules';
import { createSettlement } from '@/lib/settlement-service';

const bad = (error: string, code = 'INVALID_INPUT') => NextResponse.json({ error, code }, { status: 400 });

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
export async function POST(request: Request) {
    try {
        const ctx = await getSessionCtx();
        if (!ctx) return NextResponse.json({ error: 'No has iniciado sesión' }, { status: 401 });
        const userId = ctx.userId;

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Petición no válida');
        const { amount, toUserId, fromUserId, method, groupId } = body as Record<string, unknown>;

        const received = fromUserId !== undefined && fromUserId !== null;
        if (received) {
            if (typeof fromUserId !== 'string' || !fromUserId) return bad('fromUserId no válido');
            if (toUserId !== undefined && toUserId !== null && toUserId !== userId) {
                return bad('Un pago recibido debe ir dirigido a ti');
            }
            if (fromUserId === userId) return bad('No puedes saldar contigo mismo');
        } else {
            if (typeof toUserId !== 'string' || !toUserId) return bad('Falta toUserId');
            if (toUserId === userId) return bad('No puedes saldar contigo mismo');
        }
        const counterpartyId = (received ? fromUserId : toUserId) as string;

        const parsed = parseSettlementAmount(amount);
        if (!parsed.ok) return bad(parsed.error, 'INVALID_AMOUNT');

        if (method !== undefined && method !== null && !isSettlementMethod(method)) return bad('Método de pago no válido');

        if (groupId !== undefined && groupId !== null && (typeof groupId !== 'string' || !groupId)) {
            return bad('groupId no válido');
        }
        const coupleId = (groupId as string | null | undefined) || (await getActiveGroup(userId));
        if (!coupleId) return bad('No tienes ningún espacio compartido activo', 'NO_SPACE');

        // Authorize against the space itself (DB membership, not the JWT claim).
        // The ARCHIVED check happens under the space lock in the service.
        const auth = await requireSpaceAccess(ctx, coupleId, { allowArchived: true, allowGuest: true });
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

        const members = await getGroupMembers(coupleId);
        if (!members.some((m) => m.id === counterpartyId)) {
            return NextResponse.json({ error: 'La otra persona no es miembro de este espacio' }, { status: 403 });
        }

        const result = await createSettlement({
            groupId: coupleId,
            callerId: userId,
            counterpartyId,
            direction: received ? 'received' : 'paid',
            cents: parsed.cents,
            method: isSettlementMethod(method) ? method : 'CASH',
        });

        return NextResponse.json({
            success: true,
            settlement: { id: result.id, status: result.status, amount: result.amount },
            merged: result.merged,
        });
    } catch (error) {
        if (error instanceof SettlementError) return NextResponse.json(error.toJSON(), { status: error.status });
        console.error('Error al registrar el pago:', error);
        return NextResponse.json({ error: 'Error al registrar el pago' }, { status: 500 });
    }
}
