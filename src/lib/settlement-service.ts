import type { Prisma } from '@/generated/prisma/client';
import { postSettlementLedger } from './ledger';
import { withSpaceLock } from './expense-tx';
import {
    SettlementError,
    assertWithinCap,
    settlementCap,
    type SettlementMethodValue,
} from './settlement-rules';

/**
 * Race-safe settlement mutations ("Quedar en paz").
 *
 * Every mutation of a space's settlements runs inside `withSpaceLock`: one DB
 * transaction that first takes a row lock on the space (`SELECT … FOR UPDATE`
 * on Couple), so creates/edits/confirms/rejects of the same space are
 * serialized and the debt read inside the transaction is the one the write is
 * checked against (no read-check-write across requests). On top of that, every
 * state change is a CONDITIONAL update (`updateMany where status = PENDING …`
 * + count check), and the ledger is posted only by the request that won the
 * PENDING → CONFIRMED transition — so it is posted exactly once.
 *
 * Rules (amounts in cents, see settlement-rules.ts):
 * - Nothing moves money in an ARCHIVED space (409 SPACE_NOT_WRITABLE).
 * - A confirmed payment never flips a debt: it must not exceed
 *   settlementCap(payer, receiver) computed at confirmation time
 *   (409 SETTLEMENT_EXCEEDS_DEBT / NOTHING_TO_SETTLE).
 * - "Ya me ha pagado" while the debtor already registered a PENDING for the
 *   same amount confirms that one instead of creating a second record; for a
 *   different amount it is rejected (409 SETTLEMENT_PENDING_EXISTS).
 */

type Tx = Prisma.TransactionClient;

// The space lock lives in expense-tx.ts so every space-scoped write (expenses,
// membership, lifecycle, recurring) shares ONE lock primitive and lock order.
export { withSpaceLock };

/** Ledger net balance (cents) of one member in one space. */
async function accountBalance(tx: Tx, groupId: string, userId: string): Promise<number> {
    const r = await tx.ledgerEntry.aggregate({ _sum: { amount: true }, where: { account: { groupId, userId } } });
    return r._sum.amount ?? 0;
}

/** Most that `fromUserId` may pay `toUserId` right now (see settlementCap). */
export async function pairCap(tx: Tx, groupId: string, fromUserId: string, toUserId: string): Promise<number> {
    const [from, to] = await Promise.all([accountBalance(tx, groupId, fromUserId), accountBalance(tx, groupId, toUserId)]);
    return settlementCap(from, to);
}

function assertWritable(spaceStatus: string): void {
    if (spaceStatus === 'ARCHIVED') {
        throw new SettlementError(409, 'SPACE_NOT_WRITABLE', 'Este espacio está archivado (solo lectura)');
    }
}

const notPending = (status?: string) =>
    new SettlementError(409, 'SETTLEMENT_NOT_PENDING', 'Este pago ya se confirmó o se rechazó', status ? { status } : {});

type SettlementRow = {
    id: string;
    coupleId: string;
    amount: number;
    fromUserId: string;
    toUserId: string;
    date: Date;
    status: string;
    method: string;
};

/** PENDING → CONFIRMED (conditional on status AND the amount that was checked) + ledger, once. */
async function confirmPending(tx: Tx, s: SettlementRow): Promise<void> {
    const claimed = await tx.settlement.updateMany({
        where: { id: s.id, status: 'PENDING', amount: s.amount },
        data: { status: 'CONFIRMED' },
    });
    if (claimed.count === 0) throw notPending();
    await postSettlementLedger(tx, {
        id: s.id,
        coupleId: s.coupleId,
        amount: s.amount,
        fromUserId: s.fromUserId,
        toUserId: s.toUserId,
        date: s.date,
    });
}

export type CreateSettlementInput = {
    groupId: string;
    callerId: string;
    counterpartyId: string;
    /** "paid" = caller says "Ya he pagado"; "received" = caller (creditor) says "Ya me ha pagado". */
    direction: 'paid' | 'received';
    cents: number;
    method: SettlementMethodValue;
};

export type CreateSettlementResult = { id: string; status: 'PENDING' | 'CONFIRMED'; amount: number; merged: boolean };

export function createSettlement(input: CreateSettlementInput): Promise<CreateSettlementResult> {
    const { groupId, callerId, counterpartyId, direction, cents, method } = input;
    return withSpaceLock(groupId, async (tx, spaceStatus) => {
        assertWritable(spaceStatus);

        if (direction === 'paid') {
            // Several open PENDINGs are allowed (partial payments); each one is
            // re-checked against the debt when the receiver confirms it.
            assertWithinCap(cents, await pairCap(tx, groupId, callerId, counterpartyId));
            const created = await tx.settlement.create({
                data: { amount: cents, fromUserId: callerId, toUserId: counterpartyId, coupleId: groupId, method, status: 'PENDING' },
            });
            return { id: created.id, status: 'PENDING', amount: created.amount, merged: false };
        }

        // received: counterparty → caller, confirmed by the creditor at once.
        const cap = await pairCap(tx, groupId, counterpartyId, callerId);
        const open = await tx.settlement.findMany({
            where: { coupleId: groupId, fromUserId: counterpartyId, toUserId: callerId, status: 'PENDING' },
        });
        if (open.length > 0) {
            // The debtor already said "Ya he pagado": that is the same payment.
            const match = open.length === 1 && open[0].amount === cents ? open[0] : null;
            if (!match) {
                throw new SettlementError(409, 'SETTLEMENT_PENDING_EXISTS',
                    'Esta persona ya registró un pago pendiente: confírmalo o recházalo antes de registrar otro',
                    { pendingId: open[0].id, pendingAmountCents: open[0].amount });
            }
            assertWithinCap(match.amount, cap);
            await confirmPending(tx, match);
            return { id: match.id, status: 'CONFIRMED', amount: match.amount, merged: true };
        }

        assertWithinCap(cents, cap);
        const created = await tx.settlement.create({
            data: { amount: cents, fromUserId: counterpartyId, toUserId: callerId, coupleId: groupId, method, status: 'CONFIRMED' },
        });
        await postSettlementLedger(tx, {
            id: created.id,
            coupleId: created.coupleId,
            amount: created.amount,
            fromUserId: created.fromUserId,
            toUserId: created.toUserId,
            date: created.date,
        });
        return { id: created.id, status: 'CONFIRMED', amount: created.amount, merged: false };
    });
}

async function loadInSpace(tx: Tx, settlementId: string, groupId: string): Promise<SettlementRow> {
    const s = await tx.settlement.findUnique({ where: { id: settlementId } });
    if (!s || s.coupleId !== groupId) throw new SettlementError(404, 'NOT_FOUND', 'Pago no encontrado');
    return s;
}

export type ResolveSettlementInput = {
    settlementId: string;
    groupId: string;
    callerId: string;
    status: 'CONFIRMED' | 'REJECTED';
    /** Amount (cents) the receiver saw on screen; 409 SETTLEMENT_CHANGED if it no longer matches. */
    expectedAmountCents?: number;
};

/** Receiver confirms or rejects a PENDING settlement addressed to them. */
export function resolveSettlement(input: ResolveSettlementInput) {
    const { settlementId, groupId, callerId, status, expectedAmountCents } = input;
    return withSpaceLock(groupId, async (tx, spaceStatus) => {
        const s = await loadInSpace(tx, settlementId, groupId);
        if (s.toUserId !== callerId) {
            throw new SettlementError(403, 'NOT_RECEIVER', 'Solo quien recibe el pago puede confirmarlo o rechazarlo');
        }
        assertWritable(spaceStatus);
        if (s.status !== 'PENDING') throw notPending(s.status);
        if (expectedAmountCents !== undefined && expectedAmountCents !== s.amount) {
            throw new SettlementError(409, 'SETTLEMENT_CHANGED',
                'El importe de este pago ha cambiado: revísalo antes de confirmarlo', { amountCents: s.amount });
        }
        if (status === 'CONFIRMED') {
            assertWithinCap(s.amount, await pairCap(tx, groupId, s.fromUserId, s.toUserId));
            await confirmPending(tx, s);
        } else {
            const claimed = await tx.settlement.updateMany({
                where: { id: s.id, status: 'PENDING' },
                data: { status: 'REJECTED' },
            });
            if (claimed.count === 0) throw notPending();
        }
        return tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
    });
}

export type EditSettlementInput = {
    settlementId: string;
    groupId: string;
    callerId: string;
    cents?: number;
    method?: SettlementMethodValue;
};

/** Payer edits amount/method of their own PENDING settlement. */
export function editSettlement(input: EditSettlementInput) {
    const { settlementId, groupId, callerId, cents, method } = input;
    return withSpaceLock(groupId, async (tx, spaceStatus) => {
        const s = await loadInSpace(tx, settlementId, groupId);
        if (s.fromUserId !== callerId) {
            throw new SettlementError(403, 'NOT_PAYER', 'Solo quien registró el pago puede editarlo');
        }
        assertWritable(spaceStatus);
        if (s.status !== 'PENDING') throw notPending(s.status);
        const amount = cents ?? s.amount;
        if (cents !== undefined) assertWithinCap(cents, await pairCap(tx, groupId, s.fromUserId, s.toUserId));
        const updated = await tx.settlement.updateMany({
            where: { id: s.id, status: 'PENDING', fromUserId: callerId },
            data: { amount, method: method ?? (s.method as SettlementMethodValue) },
        });
        if (updated.count === 0) throw notPending();
        return tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
    });
}
