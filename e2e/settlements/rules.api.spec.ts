import type { BrowserContext } from '@playwright/test';
import mariadb from 'mariadb';
import { test, expect, type NewContext } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * API rules of "Quedar en paz" (QA saldar.md S-01, S-02, S-04, S-06, S-07,
 * S-10, S-12, S-19). Every money-moving call runs under a per-space lock with
 * conditional updates, so these races must end in exactly one ledger posting
 * and never in a flipped debt.
 */

const db = mariadb.createPool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT) || 3306,
  user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, connectionLimit: 2,
});

type User = { id: string; email: string; password: string };

const contexts: BrowserContext[] = [];
async function session(newContext: NewContext, user: User) {
  const ctx = await createAuthenticatedContext(newContext, user);
  contexts.push(ctx);
  return ctx.request;
}
async function guestSession(newContext: NewContext, token: string) {
  const ctx = await newContext();
  await ctx.addCookies([{ name: 'session_token', value: token, url: process.env.TEST_BASE_URL || 'http://localhost:3000' }]);
  contexts.push(ctx);
  return ctx.request;
}

type Api = Awaited<ReturnType<typeof session>>;
const balances = async (api: Api, groupId: string) => (await (await api.get(`/api/spaces/${groupId}/balance`)).json()).balances;
const ledgerPostings = async (settlementId: string) =>
  (await db.query('SELECT id FROM LedgerTransaction WHERE settlementId = ?', [settlementId])).length;

test.beforeEach(async ({ request }) => { await resetDb(request); });
test.afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close())); });
test.afterAll(async () => { await db.end(); });

test('S-01: "Ya me ha pagado" after the debtor\'s "Ya he pagado" confirms that one; no double count', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'couple-with-debt');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const a = await session(newContext, A); const b = await session(newContext, B);

  const paid = await b.post('/api/settle', { data: { toUserId: A.id, amount: 50, groupId: g } });
  expect(paid.status()).toBe(200);
  const pendingId = (await paid.json()).settlement.id;

  const received = await a.post('/api/settle', { data: { fromUserId: B.id, amount: 50, groupId: g } });
  expect(received.status()).toBe(200);
  expect(await received.json()).toMatchObject({ merged: true, settlement: { id: pendingId, status: 'CONFIRMED', amount: 5000 } });

  // The stale "Confirmar" on Inicio cannot flip the debt any more.
  const stale = await a.patch(`/api/settle/${pendingId}/status`, { data: { status: 'CONFIRMED' } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe('SETTLEMENT_NOT_PENDING');
  expect(await balances(a, g)).toEqual({ [A.id]: 0, [B.id]: 0 });
  expect(await ledgerPostings(pendingId)).toBe(1);

  // Another "received" with nothing owed → 409, never a reversed debt.
  const again = await a.post('/api/settle', { data: { fromUserId: B.id, amount: 50, groupId: g } });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe('NOTHING_TO_SETTLE');
});

test('S-01/S-12: three concurrent "received" → one 200, the rest 409, balance 0', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'couple-with-debt');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const a = await session(newContext, A);
  const res = await Promise.all([1, 2, 3].map(() => a.post('/api/settle', { data: { fromUserId: B.id, amount: 50, groupId: g } })));
  expect(res.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
  expect(await balances(a, g)).toEqual({ [A.id]: 0, [B.id]: 0 });
  const rows = await db.query("SELECT id FROM Settlement WHERE coupleId = ? AND status = 'CONFIRMED'", [g]);
  expect(rows).toHaveLength(1);
});

test('S-01: "received" for another amount than the open PENDING is refused; edits are capped; reject still works', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'couple-with-pending-settlement');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const a = await session(newContext, A); const b = await session(newContext, B);
  const conflict = await a.post('/api/settle', { data: { fromUserId: B.id, amount: 20, groupId: g } });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'SETTLEMENT_PENDING_EXISTS', pendingId: seed.settlementId, pendingAmountCents: 5000 });
  // Editing above the debt (50 €) is refused.
  const over = await b.patch(`/api/settle/${seed.settlementId}`, { data: { amount: 60 } });
  expect(over.status()).toBe(409);
  expect((await over.json()).code).toBe('SETTLEMENT_EXCEEDS_DEBT');
  const reject = await a.patch(`/api/settle/${seed.settlementId}/status`, { data: { status: 'REJECTED' } });
  expect(reject.status()).toBe(200);
  expect(await balances(a, g)).toEqual({ [A.id]: 5000, [B.id]: -5000 });
});

test('S-02: concurrent confirm + edit never leave a PENDING with another amount', async ({ request, newContext }) => {
  for (let round = 0; round < 3; round++) {
    await resetDb(request);
    const seed = await seedScenario(request, 'couple-with-pending-settlement');
    const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
    const id = seed.settlementId as string;
    const a = await session(newContext, A); const b = await session(newContext, B);
    const [confirm, edit] = await Promise.all([
      a.patch(`/api/settle/${id}/status`, { data: { status: 'CONFIRMED' } }),
      b.patch(`/api/settle/${id}`, { data: { amount: 1 } }),
    ]);
    const [row] = await db.query('SELECT status, amount FROM Settlement WHERE id = ?', [id]);
    expect(confirm.status()).toBe(200);
    expect(row.status).toBe('CONFIRMED');
    if (edit.status() === 200) {
      // The edit won the lock first: the confirm applied to the edited amount.
      expect(row.amount).toBe(100);
      expect(await balances(a, g)).toEqual({ [A.id]: 4900, [B.id]: -4900 });
    } else {
      expect(edit.status()).toBe(409);
      expect(row.amount).toBe(5000);
      expect(await balances(a, g)).toEqual({ [A.id]: 0, [B.id]: 0 });
    }
    expect(await ledgerPostings(id)).toBe(1);
  }
});

test('S-06: the receiver confirms the amount they saw (409 SETTLEMENT_CHANGED otherwise)', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'couple-with-pending-settlement');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const id = seed.settlementId as string;
  const a = await session(newContext, A); const b = await session(newContext, B);
  expect((await b.patch(`/api/settle/${id}`, { data: { amount: 5 } })).status()).toBe(200);
  const stale = await a.patch(`/api/settle/${id}/status`, { data: { status: 'CONFIRMED', expectedAmountCents: 5000 } });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'SETTLEMENT_CHANGED', amountCents: 500 });
  expect(await balances(a, g)).toEqual({ [A.id]: 5000, [B.id]: -5000 });
  expect((await a.patch(`/api/settle/${id}/status`, { data: { status: 'CONFIRMED', expectedAmountCents: 500 } })).status()).toBe(200);
  expect(await balances(a, g)).toEqual({ [A.id]: 4500, [B.id]: -4500 });
});

test('S-07: ARCHIVED space → create/edit/confirm/reject are 409 SPACE_NOT_WRITABLE', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'space-settling');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const id = seed.settlementId as string;
  const a = await session(newContext, A); const b = await session(newContext, B);
  // Archive straight in the DB: whether archiving with debts is allowed is the spaces flow's call.
  await db.query("UPDATE Couple SET status = 'ARCHIVED' WHERE id = ?", [g]);
  const calls = [
    await b.patch(`/api/settle/${id}`, { data: { amount: 45 } }),
    await a.patch(`/api/settle/${id}/status`, { data: { status: 'CONFIRMED' } }),
    await a.patch(`/api/settle/${id}/status`, { data: { status: 'REJECTED' } }),
    await b.post('/api/settle', { data: { toUserId: A.id, amount: 10, groupId: g } }),
    await a.post('/api/settle', { data: { fromUserId: B.id, amount: 10, groupId: g } }),
  ];
  for (const r of calls) {
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe('SPACE_NOT_WRITABLE');
  }
  const [row] = await db.query('SELECT status, amount FROM Settlement WHERE id = ?', [id]);
  expect(row).toMatchObject({ status: 'PENDING', amount: 5000 });
});

test('S-10/S-12/S-19: malformed amounts and inputs are 400, never 500 or a 0 € settlement', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'couple-with-debt');
  const A = seed.userA as User; const B = seed.userB as User; const g = seed.coupleId as string;
  const b = await session(newContext, B);
  for (const amount of [0, 0.004, '', [], true, '12', 1e12, -5, null]) {
    const r = await b.post('/api/settle', { data: { toUserId: A.id, amount, groupId: g } });
    expect(r.status(), `amount ${JSON.stringify(amount)}`).toBe(400);
    expect((await r.json()).code).toBe('INVALID_AMOUNT');
  }
  expect((await b.post('/api/settle', { data: { toUserId: A.id, amount: 10, groupId: 123 } })).status()).toBe(400);
  // More than the debt → 409 with the max.
  const over = await b.post('/api/settle', { data: { toUserId: A.id, amount: 50.01, groupId: g } });
  expect(over.status()).toBe(409);
  expect(await over.json()).toMatchObject({ code: 'SETTLEMENT_EXCEEDS_DEBT', maxAmountCents: 5000 });
  // The debtor cannot claim the creditor paid them (that would invert the debt).
  const reverse = await b.post('/api/settle', { data: { fromUserId: A.id, amount: 10, groupId: g } });
  expect(reverse.status()).toBe(409);
  expect(await db.query('SELECT id FROM Settlement WHERE coupleId = ?', [g])).toHaveLength(0);
});

test('S-04/S-08: a guest owed money confirms the payment addressed to them; edits their own PENDING', async ({ request, newContext }) => {
  const seed = await seedScenario(request, 'ephemeral-with-guest');
  const owner = seed.owner as User; const guest = seed.guest as { id: string; sessionToken: string };
  const g = seed.coupleId as string;
  const o = await session(newContext, owner);
  const gu = await guestSession(newContext, guest.sessionToken);

  // Guest pays 100 € split equally → the owner owes the guest 20 € net.
  expect((await gu.post('/api/expenses', { data: { description: 'Peaje', amount: 100, category: 'other' } })).status()).toBe(200);
  expect(await balances(o, g)).toEqual({ [owner.id]: -2000, [guest.id]: 2000 });

  const paid = await o.post('/api/settle', { data: { toUserId: guest.id, amount: 20, groupId: g } });
  expect(paid.status()).toBe(200);
  const id = (await paid.json()).settlement.id;
  const confirm = await gu.patch(`/api/settle/${id}/status`, { data: { status: 'CONFIRMED', expectedAmountCents: 2000 } });
  expect(confirm.status()).toBe(200);
  expect(await balances(o, g)).toEqual({ [owner.id]: 0, [guest.id]: 0 });

  // Now the guest owes again (owner pays 60 more), the guest registers and edits a PENDING.
  expect((await o.post('/api/expenses', { data: { description: 'Cena', amount: 60, category: 'other' } })).status()).toBe(200);
  const gPaid = await gu.post('/api/settle', { data: { toUserId: owner.id, amount: 10, groupId: g } });
  expect(gPaid.status()).toBe(200);
  const gId = (await gPaid.json()).settlement.id;
  expect((await gu.patch(`/api/settle/${gId}`, { data: { amount: 15 } })).status()).toBe(200);
  // …but cannot confirm their own payment.
  expect((await gu.patch(`/api/settle/${gId}/status`, { data: { status: 'CONFIRMED' } })).status()).toBe(403);
});
