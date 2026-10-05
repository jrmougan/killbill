import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * In-memory fake of the bits of Prisma the settlement service uses. It emulates
 * the space row lock (`SELECT … FOR UPDATE` on Couple): a transaction holds a
 * per-space mutex from its lock query until it commits/rolls back, and a thrown
 * error rolls the state back. That lets these tests fire concurrent calls and
 * assert the serialized, conditional behaviour end to end.
 */
type Row = {
    id: string; coupleId: string; fromUserId: string; toUserId: string; amount: number;
    status: string; method: string; date: Date;
};
const state = {
    spaces: new Map<string, string>(),
    settlements: new Map<string, Row>(),
    balances: new Map<string, number>(),
    postings: [] as string[],
    seq: 0,
};
const locks = new Map<string, Promise<void>>();

const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

function snapshot() {
    return {
        settlements: new Map([...state.settlements].map(([k, v]) => [k, { ...v }])),
        balances: new Map(state.balances),
        postings: [...state.postings],
    };
}

function makeTx(onLock: (release: () => void) => void) {
    return {
        $queryRaw: async (_s: TemplateStringsArray, groupId: string) => {
            while (locks.has(groupId)) await locks.get(groupId);
            let release!: () => void;
            locks.set(groupId, new Promise<void>((r) => (release = () => { locks.delete(groupId); r(); })));
            onLock(release);
            // Yield so concurrent callers really interleave.
            await new Promise((r) => setTimeout(r, 1));
            const status = state.spaces.get(groupId);
            return status ? [{ status }] : [];
        },
        ledgerEntry: {
            aggregate: async ({ where }: { where: { account: { groupId: string; userId: string } } }) => ({
                _sum: { amount: state.balances.get(`${where.account.groupId}:${where.account.userId}`) ?? 0 },
            }),
        },
        settlement: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) =>
                [...state.settlements.values()].find((r) => matches(r, where)) ?? null,
            findMany: async ({ where }: { where: Record<string, unknown> }) =>
                [...state.settlements.values()].filter((r) => matches(r, where)).map((r) => ({ ...r })),
            findUnique: async ({ where }: { where: { id: string } }) => {
                const r = state.settlements.get(where.id);
                return r ? { ...r } : null;
            },
            findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...state.settlements.get(where.id)! }),
            create: async ({ data }: { data: Omit<Row, 'id' | 'date'> }) => {
                const row: Row = { id: `s${++state.seq}`, date: new Date(), ...data };
                state.settlements.set(row.id, row);
                return { ...row };
            },
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
                let count = 0;
                for (const r of state.settlements.values()) {
                    if (matches(r, where)) { Object.assign(r, data); count++; }
                }
                return { count };
            },
        },
    };
}

vi.mock('./db', () => ({
    prisma: {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
            let release: (() => void) | null = null;
            // Snapshot when the lock is taken (= what this transaction may roll back).
            let before: ReturnType<typeof snapshot> | null = null;
            const tx = makeTx((r) => { release = r; before = snapshot(); });
            try {
                return await fn(tx);
            } catch (e) {
                const b = before as ReturnType<typeof snapshot> | null;
                if (b) {
                    state.settlements = b.settlements;
                    state.balances = b.balances;
                    state.postings = b.postings;
                }
                throw e;
            } finally {
                (release as (() => void) | null)?.();
            }
        },
    },
}));

vi.mock('./ledger', () => ({
    postSettlementLedger: async (_tx: unknown, s: { id: string; coupleId: string; amount: number; fromUserId: string; toUserId: string }) => {
        const k = (u: string) => `${s.coupleId}:${u}`;
        state.balances.set(k(s.fromUserId), (state.balances.get(k(s.fromUserId)) ?? 0) + s.amount);
        state.balances.set(k(s.toUserId), (state.balances.get(k(s.toUserId)) ?? 0) - s.amount);
        state.postings.push(s.id);
    },
}));

import { createSettlement, editSettlement, resolveSettlement } from './settlement-service';
import { SettlementError } from './settlement-rules';

const G = 'g1';
// Couple: B owes A 50 €.
function seed(balances: Record<string, number> = { A: 5000, B: -5000 }, status = 'ACTIVE') {
    state.spaces = new Map([[G, status]]);
    state.settlements = new Map();
    state.balances = new Map(Object.entries(balances).map(([u, c]) => [`${G}:${u}`, c]));
    state.postings = [];
    state.seq = 0;
    locks.clear();
}
const bal = (u: string) => state.balances.get(`${G}:${u}`) ?? 0;

async function code(p: Promise<unknown>): Promise<string> {
    try {
        await p;
        return 'OK';
    } catch (e) {
        if (e instanceof SettlementError) return `${e.status} ${e.code}`;
        throw e;
    }
}

const paid = (cents: number, from = 'B', to = 'A') =>
    createSettlement({ groupId: G, callerId: from, counterpartyId: to, direction: 'paid', cents, method: 'BIZUM' });
const received = (cents: number, from = 'B', to = 'A') =>
    createSettlement({ groupId: G, callerId: to, counterpartyId: from, direction: 'received', cents, method: 'CASH' });
const confirm = (id: string, caller = 'A', expectedAmountCents?: number) =>
    resolveSettlement({ settlementId: id, groupId: G, callerId: caller, status: 'CONFIRMED', expectedAmountCents });
const reject = (id: string, caller = 'A') =>
    resolveSettlement({ settlementId: id, groupId: G, callerId: caller, status: 'REJECTED' });
const edit = (id: string, cents: number, caller = 'B') =>
    editSettlement({ settlementId: id, groupId: G, callerId: caller, cents });

describe('settlement-service — S-01 double counting', () => {
    beforeEach(() => seed());

    it('"Ya me ha pagado" with a matching PENDING confirms that one (no second record)', async () => {
        const p = await paid(5000);
        const r = await received(5000);
        expect(r).toEqual({ id: p.id, status: 'CONFIRMED', amount: 5000, merged: true });
        expect(state.settlements.size).toBe(1);
        expect(state.postings).toEqual([p.id]);
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
        // The stale "Confirmar" on Inicio is now a 409, never a flipped debt.
        expect(await code(confirm(p.id))).toBe('409 SETTLEMENT_NOT_PENDING');
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
    });

    it('"Ya me ha pagado" with a PENDING of another amount is rejected 409 (with its id)', async () => {
        const p = await paid(2000);
        await expect(received(5000)).rejects.toMatchObject({ status: 409, code: 'SETTLEMENT_PENDING_EXISTS', extra: { pendingId: p.id, pendingAmountCents: 2000 } });
        expect(state.settlements.size).toBe(1);
    });

    it('confirming a PENDING that exceeds the current debt is refused (no flip)', async () => {
        const q = await paid(5000);
        // Meanwhile the debt shrinks to 30 € (e.g. an expense was edited).
        state.balances.set(`${G}:A`, 3000);
        state.balances.set(`${G}:B`, -3000);
        expect(await code(confirm(q.id))).toBe('409 SETTLEMENT_EXCEEDS_DEBT');
        expect(state.settlements.get(q.id)!.status).toBe('PENDING');
        expect(state.postings).toEqual([]);
        // Rejecting it is always possible.
        expect(await code(reject(q.id))).toBe('OK');
    });

    it('"received" is capped to the current debt and refused in the reverse direction', async () => {
        expect(await code(received(5001))).toBe('409 SETTLEMENT_EXCEEDS_DEBT');
        // The debtor B claims A paid them: A is owed, nothing to receive → 409.
        expect(await code(received(100, 'A', 'B'))).toBe('409 NOTHING_TO_SETTLE');
        expect(state.settlements.size).toBe(0);
    });

    it('"paid" is capped to the debt; two PENDINGs above the debt cannot both be confirmed', async () => {
        expect(await code(paid(5001))).toBe('409 SETTLEMENT_EXCEEDS_DEBT');
        expect(await code(paid(100, 'A', 'B'))).toBe('409 NOTHING_TO_SETTLE');
        const p1 = await paid(5000);
        const p2 = await paid(5000);
        expect(await code(confirm(p1.id))).toBe('OK');
        expect(await code(confirm(p2.id))).toBe('409 NOTHING_TO_SETTLE');
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
    });

    it('three concurrent "received" for the full debt: one wins, the rest 409, balance never flips', async () => {
        const results = await Promise.all([received(5000), received(5000), received(5000)].map(code));
        expect(results.sort()).toEqual(['409 NOTHING_TO_SETTLE', '409 NOTHING_TO_SETTLE', 'OK']);
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
        expect(state.postings).toHaveLength(1);
    });

    it('concurrent "Ya he pagado" + "Ya me ha pagado": counted exactly once', async () => {
        const results = await Promise.all([code(paid(5000)), code(received(5000))]);
        expect(results.filter((r) => r === 'OK').length).toBeGreaterThanOrEqual(1);
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
        expect(state.postings).toHaveLength(1);
        // Whatever is left PENDING can no longer be confirmed.
        for (const s of state.settlements.values()) {
            if (s.status === 'PENDING') expect(await code(confirm(s.id))).toBe('409 NOTHING_TO_SETTLE');
        }
        expect([bal('A'), bal('B')]).toEqual([0, 0]);
    });

    it('a partial payment leaves the rest owed', async () => {
        const p = await paid(2000);
        await confirm(p.id, 'A', 2000);
        expect([bal('A'), bal('B')]).toEqual([3000, -3000]);
    });
});

describe('settlement-service — S-02 edit vs confirm race', () => {
    beforeEach(() => seed());

    it('concurrent confirm + edit: never "PENDING with another amount" after a confirm', async () => {
        for (let i = 0; i < 5; i++) {
            seed();
            const p = await paid(5000);
            const [c, e] = await Promise.all([code(confirm(p.id)), code(edit(p.id, 100))]);
            const row = state.settlements.get(p.id)!;
            if (c === 'OK') {
                expect(row.status).toBe('CONFIRMED');
                expect(row.amount).toBe(5000);
                expect(e).toBe('409 SETTLEMENT_NOT_PENDING');
                expect([bal('A'), bal('B')]).toEqual([0, 0]);
            } else {
                // Edit won first: confirm still applies to the edited amount.
                expect(e).toBe('OK');
                expect(row.status).toBe('CONFIRMED');
                expect([bal('A'), bal('B')]).toEqual([4900, -4900]);
            }
            expect(state.postings).toEqual([p.id]);
        }
    });

    it('double confirm posts the ledger once (second is 409)', async () => {
        const p = await paid(5000);
        const results = await Promise.all([confirm(p.id), confirm(p.id)].map(code));
        expect(results.sort()).toEqual(['409 SETTLEMENT_NOT_PENDING', 'OK']);
        expect(state.postings).toEqual([p.id]);
    });

    it('edit after reject/confirm → 409; edit by someone else → 403', async () => {
        const p = await paid(5000);
        expect(await code(edit(p.id, 4000, 'A'))).toBe('403 NOT_PAYER');
        await reject(p.id);
        expect(await code(edit(p.id, 4000))).toBe('409 SETTLEMENT_NOT_PENDING');
        expect(await code(confirm(p.id))).toBe('409 SETTLEMENT_NOT_PENDING');
    });

    it('edit cannot exceed the debt', async () => {
        const p = await paid(1000);
        expect(await code(edit(p.id, 6000))).toBe('409 SETTLEMENT_EXCEEDS_DEBT');
        expect(await code(edit(p.id, 4000))).toBe('OK');
        expect(state.settlements.get(p.id)!.amount).toBe(4000);
    });
});

describe('settlement-service — S-06 confirm what you saw / authz / archived', () => {
    beforeEach(() => seed());

    it('409 SETTLEMENT_CHANGED when the amount was edited after the receiver saw it', async () => {
        const p = await paid(5000);
        await edit(p.id, 500);
        await expect(confirm(p.id, 'A', 5000)).rejects.toMatchObject({ status: 409, code: 'SETTLEMENT_CHANGED', extra: { amountCents: 500 } });
        expect(state.settlements.get(p.id)!.status).toBe('PENDING');
        expect(await code(confirm(p.id, 'A', 500))).toBe('OK');
        expect([bal('A'), bal('B')]).toEqual([4500, -4500]);
    });

    it('only the receiver resolves', async () => {
        const p = await paid(5000);
        expect(await code(confirm(p.id, 'B'))).toBe('403 NOT_RECEIVER');
        expect(await code(reject(p.id, 'B'))).toBe('403 NOT_RECEIVER');
    });

    it('a settlement of another space is not found', async () => {
        const p = await paid(5000);
        await expect(resolveSettlement({ settlementId: p.id, groupId: 'other', callerId: 'A', status: 'CONFIRMED' }))
            .rejects.toMatchObject({ status: 404 });
    });

    it('ARCHIVED: create, edit, confirm and reject are 409 SPACE_NOT_WRITABLE', async () => {
        const p = await paid(5000);
        state.spaces.set(G, 'ARCHIVED');
        expect(await code(paid(100))).toBe('409 SPACE_NOT_WRITABLE');
        expect(await code(received(100))).toBe('409 SPACE_NOT_WRITABLE');
        expect(await code(edit(p.id, 100))).toBe('409 SPACE_NOT_WRITABLE');
        expect(await code(confirm(p.id))).toBe('409 SPACE_NOT_WRITABLE');
        expect(await code(reject(p.id))).toBe('409 SPACE_NOT_WRITABLE');
    });

    it('SETTLING still allows settling', async () => {
        state.spaces.set(G, 'SETTLING');
        const p = await paid(5000);
        expect(await code(confirm(p.id))).toBe('OK');
    });
});

describe('settlement-service — groups', () => {
    it('a debtor may pay any creditor up to min(what they owe, what that creditor is owed)', async () => {
        seed({ A: 4000, B: 1000, C: -5000 });
        expect(await code(paid(1001, 'C', 'B'))).toBe('409 SETTLEMENT_EXCEEDS_DEBT');
        const p = await paid(1000, 'C', 'B');
        expect(await code(confirm(p.id, 'B'))).toBe('OK');
        expect([bal('A'), bal('B'), bal('C')]).toEqual([4000, 0, -4000]);
    });
});
