import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx, requireSpaceAccess } from '@/lib/authz';
import { getActiveGroup, getGroupMembers } from '@/lib/membership';
import { toCents } from '@/lib/currency';
import { postSettlementLedger } from '@/lib/ledger';
import { SpaceStatus } from '@/generated/prisma/enums';

/**
 * Record a settlement in a space.
 *
 * Two directions (EQUIL "Quedar en paz", see docs/design/README.md → Settle):
 *
 * - **Paid** (default, `{ toUserId }`): the caller says "Ya he pagado". The
 *   settlement is created PENDING (caller → toUserId) and only enters the balance
 *   when the receiver confirms it via /api/settle/[id]/status (two-step
 *   confirmation is kept: the debtor's word alone never moves the balance).
 *
 * - **Received** (`{ fromUserId }`): the caller is the CREDITOR and says "Ya me
 *   ha pagado". The settlement (fromUserId → caller) is created CONFIRMED and its
 *   ledger transaction posted in the same DB transaction. This is consistent with
 *   the authz model of the status route, where only the receiver may confirm:
 *   the creditor acknowledging receipt is exactly the trustworthy side, and it can
 *   only ever reduce the counterparty's debt. Guests cannot confirm settlements
 *   (status route denies them), so they cannot use this direction either.
 *
 * The space is the optional `groupId` (authorized against the resource's own
 * group) or, failing that, the caller's active group. SETTLING spaces allow
 * settling; ARCHIVED ones are read-only.
 */
export async function POST(request: Request) {
    try {
        const ctx = await getSessionCtx();
        if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = ctx.userId;

        const body = await request.json();
        const { amount, toUserId, fromUserId, method, groupId } = body ?? {};

        const received = fromUserId !== undefined && fromUserId !== null;
        if (received) {
            if (typeof fromUserId !== 'string' || !fromUserId) {
                return NextResponse.json({ error: 'Invalid fromUserId' }, { status: 400 });
            }
            if (toUserId !== undefined && toUserId !== userId) {
                return NextResponse.json({ error: 'A received payment must be addressed to you' }, { status: 400 });
            }
            if (fromUserId === userId) return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });
        } else {
            if (!toUserId) return NextResponse.json({ error: 'toUserId is required' }, { status: 400 });
            if (toUserId === userId) return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });
        }
        const counterpartyId = (received ? fromUserId : toUserId) as string;

        const numericAmount = Number(amount);
        // amount === 0 is allowed for a paid settlement: it records a "checkpoint"
        // used to archive/clear the pending list when there are no outstanding
        // debts. A received (auto-confirmed) settlement must move money.
        if (!Number.isFinite(numericAmount) || numericAmount < 0 || (received && numericAmount <= 0)) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        if (method !== undefined && !['CASH', 'BIZUM', 'TRANSFER'].includes(method)) {
            return NextResponse.json({ error: 'Invalid method' }, { status: 400 });
        }

        const coupleId = typeof groupId === 'string' && groupId ? groupId : await getActiveGroup(userId);
        if (!coupleId) return NextResponse.json({ error: 'No Couple' }, { status: 400 });

        // Authorize against the space itself (DB membership, not the JWT claim).
        // Guests may record a payment they made, never confirm one received.
        const auth = await requireSpaceAccess(ctx, coupleId, { allowArchived: true, allowGuest: !received });
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

        if (auth.space.status === SpaceStatus.ARCHIVED) {
            return NextResponse.json(
                { error: 'Este espacio está archivado (solo lectura)', code: 'SPACE_NOT_WRITABLE' },
                { status: 409 },
            );
        }

        const members = await getGroupMembers(coupleId);
        if (!members.some((m) => m.id === counterpartyId)) {
            return NextResponse.json({ error: 'The other user is not a member of this space' }, { status: 403 });
        }

        const settlement = await prisma.$transaction(async (tx) => {
            const created = await tx.settlement.create({
                data: {
                    amount: toCents(numericAmount),
                    fromUserId: received ? counterpartyId : userId,
                    toUserId: received ? userId : counterpartyId,
                    coupleId,
                    method: method || 'CASH',
                    status: received ? 'CONFIRMED' : 'PENDING',
                },
            });
            if (received) {
                // Same posting the status route does on PENDING→CONFIRMED.
                await postSettlementLedger(tx, {
                    id: created.id,
                    coupleId: created.coupleId,
                    amount: created.amount,
                    fromUserId: created.fromUserId,
                    toUserId: created.toUserId,
                    date: created.date,
                });
            }
            return created;
        });

        return NextResponse.json({ success: true, settlement: { id: settlement.id, status: settlement.status } });
    } catch (error) {
        console.error('Error al registrar el pago:', error);
        return NextResponse.json({ error: 'Error al registrar el pago' }, { status: 500 });
    }
}
