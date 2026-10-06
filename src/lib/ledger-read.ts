import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Ledger-sourced net balances (integer CENTS). Σ LedgerEntry.amount over each
 * member's Account — the EXACT quantity scripts/reconcile-ledger.ts proves equal
 * to finance.ts.calculateBalances.
 *
 * The sums are aggregated IN THE DATABASE (`groupBy … _sum`), never by loading
 * every entry into JS (M2), and the batched variant serves any number of spaces
 * with the same two queries (Inicio / Espacios).
 *
 * Results are restricted to ACTIVE members (keyed only by them, in join order),
 * defaulting to 0 when a member has no account/entries — identical to reconcile
 * GATE A. Positive = member is owed; negative = member owes.
 *
 * Pass a transaction client to read inside a transaction (e.g. under the space
 * lock) instead of the global client — members are then read through it too.
 */

type Db = Prisma.TransactionClient;

/** Raw per-(space, user) ledger nets for every account of the given spaces. */
export async function sumLedgerByGroup(
    groupIds: string[],
    db: Db = prisma,
): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>();
    if (groupIds.length === 0) return out;
    const where = { groupId: { in: groupIds } };
    const [accounts, sums] = await Promise.all([
        db.account.findMany({ where, select: { id: true, groupId: true, userId: true } }),
        db.ledgerEntry.groupBy({
            by: ['accountId'],
            where: { account: where },
            _sum: { amount: true },
        }),
    ]);
    const byAccount = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
    for (const a of accounts) {
        let group = out.get(a.groupId);
        if (!group) out.set(a.groupId, (group = new Map()));
        group.set(a.userId, (group.get(a.userId) ?? 0) + (byAccount.get(a.id) ?? 0));
    }
    return out;
}

/** Restrict raw nets to the given (ACTIVE) member ids, in that order, 0 by default. */
export function balancesForMembers(
    nets: Map<string, number> | undefined,
    memberIds: readonly string[],
): Record<string, number> {
    const balances: Record<string, number> = {};
    for (const id of memberIds) balances[id] = nets?.get(id) ?? 0;
    return balances;
}

/** ACTIVE member ids of a space in the canonical order (joinedAt, userId) — see getGroupMembers. */
async function activeMemberIds(groupId: string, db: Db): Promise<string[]> {
    const rows = await db.membership.findMany({
        where: { groupId, status: 'ACTIVE' },
        orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
        select: { userId: true },
    });
    return rows.map((r) => r.userId);
}

/**
 * Balances of one space's ACTIVE members. `memberIds` lets a caller that already
 * loaded the roster skip reading it again (e.g. the balance route).
 */
export async function getGroupBalances(
    groupId: string,
    db: Db = prisma,
    memberIds?: readonly string[],
): Promise<Record<string, number>> {
    const [ids, nets] = await Promise.all([
        memberIds ? Promise.resolve(memberIds) : activeMemberIds(groupId, db),
        sumLedgerByGroup([groupId], db),
    ]);
    return balancesForMembers(nets.get(groupId), ids);
}
