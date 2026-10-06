import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { balancesForMembers, getGroupBalances, sumLedgerByGroup } from './ledger-read';

/**
 * Fixture ledger: accounts of several spaces with signed entries, members with
 * ACTIVE/LEFT/REMOVED status. The fake client answers the same queries Prisma
 * would (account.findMany, ledgerEntry.groupBy with _sum, membership.findMany).
 */
type Account = { id: string; groupId: string; userId: string };
type Entry = { accountId: string; amount: number };
type Membership = { groupId: string; userId: string; status: string; joinedAt: number };

const accounts: Account[] = [
    { id: 'a1', groupId: 'g1', userId: 'u1' },
    { id: 'a2', groupId: 'g1', userId: 'u2' },
    { id: 'a3', groupId: 'g1', userId: 'u3' }, // u3 LEFT with an open balance
    { id: 'b1', groupId: 'g2', userId: 'u1' },
    { id: 'b2', groupId: 'g2', userId: 'u4' },
    { id: 'c1', groupId: 'g3', userId: 'u5' }, // account without entries
];
const entries: Entry[] = [
    // g1: expense 90 € paid by u1 split 3 ways, then a settlement u2 → u1 of 20 €
    { accountId: 'a1', amount: 6000 }, { accountId: 'a2', amount: -3000 }, { accountId: 'a3', amount: -3000 },
    { accountId: 'a2', amount: 2000 }, { accountId: 'a1', amount: -2000 },
    // g1: 1 cent remainder expense
    { accountId: 'a1', amount: -1 }, { accountId: 'a2', amount: 1 },
    // g2: u4 paid 33,33 € for both
    { accountId: 'b2', amount: 1667 }, { accountId: 'b1', amount: -1667 },
];
const memberships: Membership[] = [
    { groupId: 'g1', userId: 'u2', status: 'ACTIVE', joinedAt: 2 },
    { groupId: 'g1', userId: 'u1', status: 'ACTIVE', joinedAt: 1 },
    { groupId: 'g1', userId: 'u3', status: 'LEFT', joinedAt: 3 },
    { groupId: 'g1', userId: 'u9', status: 'ACTIVE', joinedAt: 4 }, // member without account
    { groupId: 'g2', userId: 'u1', status: 'ACTIVE', joinedAt: 1 },
    { groupId: 'g2', userId: 'u4', status: 'REMOVED', joinedAt: 2 },
    { groupId: 'g3', userId: 'u5', status: 'ACTIVE', joinedAt: 1 },
];

const inGroups = (where: { groupId: { in: string[] } | string }) => (a: Account) =>
    typeof where.groupId === 'string' ? a.groupId === where.groupId : where.groupId.in.includes(a.groupId);

function fakeDb() {
    const groupBy = vi.fn(async ({ where }: { where: { account: { groupId: { in: string[] } } } }) => {
        const ids = new Set(accounts.filter(inGroups(where.account)).map((a) => a.id));
        const sums = new Map<string, number>();
        for (const e of entries) if (ids.has(e.accountId)) sums.set(e.accountId, (sums.get(e.accountId) ?? 0) + e.amount);
        return [...sums].map(([accountId, amount]) => ({ accountId, _sum: { amount } }));
    });
    const db = {
        account: {
            findMany: vi.fn(async ({ where }: { where: { groupId: { in: string[] } | string }; include?: unknown }) =>
                accounts.filter(inGroups(where)).map((a) => ({
                    ...a,
                    // Only used by the OLD implementation below (include: { entries }).
                    entries: entries.filter((e) => e.accountId === a.id).map((e) => ({ amount: e.amount })),
                }))),
        },
        ledgerEntry: { groupBy },
        membership: {
            findMany: vi.fn(async ({ where }: { where: { groupId: string; status: string } }) =>
                memberships
                    .filter((m) => m.groupId === where.groupId && m.status === where.status)
                    .sort((x, y) => x.joinedAt - y.joinedAt || x.userId.localeCompare(y.userId))
                    .map((m) => ({ userId: m.userId }))),
        },
    };
    return { db: db as unknown as Prisma.TransactionClient, raw: db };
}

/** The previous implementation, verbatim in spirit: load every entry, sum in JS. */
async function oldGetGroupBalances(groupId: string, db: Prisma.TransactionClient): Promise<Record<string, number>> {
    const members = (await db.membership.findMany({
        where: { groupId, status: 'ACTIVE' },
        orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
        select: { userId: true },
    })).map((m) => ({ id: m.userId }));
    const accts = await db.account.findMany({ where: { groupId }, include: { entries: { select: { amount: true } } } });
    const byUser = new Map<string, number>();
    for (const a of accts) byUser.set(a.userId, a.entries.reduce((sum, e) => sum + e.amount, 0));
    const balances: Record<string, number> = {};
    for (const m of members) balances[m.id] = byUser.get(m.id) ?? 0;
    return balances;
}

describe('ledger-read — SQL aggregation (M2)', () => {
    it.each(['g1', 'g2', 'g3', 'g-empty'])('getGroupBalances(%s) is identical to the old JS summation', async (g) => {
        const { db } = fakeDb();
        const next = await getGroupBalances(g, db);
        const prev = await oldGetGroupBalances(g, db);
        expect(next).toEqual(prev);
        // Same key ORDER too (join order drives the UI and remainder allocation).
        expect(Object.keys(next)).toEqual(Object.keys(prev));
    });

    it('known values: ACTIVE members only, 0 for a member without account', async () => {
        const { db } = fakeDb();
        expect(await getGroupBalances('g1', db)).toEqual({ u1: 3999, u2: -999, u9: 0 });
        expect(await getGroupBalances('g2', db)).toEqual({ u1: -1667 });
    });

    it('sums in the database (groupBy _sum), never loading entry rows', async () => {
        const { db, raw } = fakeDb();
        await getGroupBalances('g1', db);
        expect(raw.ledgerEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['accountId'], _sum: { amount: true } }));
        expect(raw.account.findMany.mock.calls[0][0]).not.toHaveProperty('include');
    });

    it('a pre-loaded roster skips the membership read', async () => {
        const { db, raw } = fakeDb();
        expect(await getGroupBalances('g1', db, ['u2', 'u1'])).toEqual({ u2: -999, u1: 3999 });
        expect(raw.membership.findMany).not.toHaveBeenCalled();
    });

    it('batched: ONE pair of queries for every space, same results as per-space', async () => {
        const { db, raw } = fakeDb();
        const nets = await sumLedgerByGroup(['g1', 'g2', 'g3'], db);
        expect(raw.ledgerEntry.groupBy).toHaveBeenCalledOnce();
        expect(raw.account.findMany).toHaveBeenCalledOnce();
        for (const g of ['g1', 'g2', 'g3']) {
            const roster = Object.keys(await oldGetGroupBalances(g, db));
            expect(balancesForMembers(nets.get(g), roster)).toEqual(await oldGetGroupBalances(g, db));
        }
        // The ledger of every space (all accounts, incl. ex-members) stays zero-sum.
        for (const g of ['g1', 'g2']) {
            expect([...nets.get(g)!.values()].reduce((s, v) => s + v, 0)).toBe(0);
        }
    });

    it('no spaces → no queries', async () => {
        const { db, raw } = fakeDb();
        expect((await sumLedgerByGroup([], db)).size).toBe(0);
        expect(raw.ledgerEntry.groupBy).not.toHaveBeenCalled();
    });
});
