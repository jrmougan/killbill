import type { APIRequestContext } from '@playwright/test';
import { test, expect, type NewContext } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import mariadb from 'mariadb';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

const db = mariadb.createPool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT) || 3306,
  user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, connectionLimit: 2,
});

type User = { id: string; email: string; password: string };
const REPETITIONS = 5;

async function session(newContext: NewContext, user: User) {
  return createAuthenticatedContext(newContext, user);
}

async function invite(api: APIRequestContext, groupId: string, maxUses: number) {
  const response = await api.post(`/api/spaces/${groupId}/invites`, {
    data: { maxUses, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(response.status()).toBe(200);
  return await response.json() as { token: string; invite: { id: string } };
}

test.beforeEach(async ({ request }) => { await resetDb(request); });
test.afterAll(async () => { await db.end(); });

test('simultaneous confirmations post exactly one settlement in integer cents', async ({ request, newContext }) => {
  for (let round = 0; round < REPETITIONS; round++) {
    const seed = await seedScenario(request, 'couple-with-pending-settlement');
    const receiver = seed.userA as User;
    const payer = seed.userB as User;
    const first = await session(newContext, receiver);
    const second = await session(newContext, receiver);
    try {
      const balanceUrl = `/api/spaces/${seed.coupleId}/balance`;
      const before = await first.request.get(balanceUrl);
      expect(before.status()).toBe(200);
      expect((await before.json()).balances).toEqual({ [receiver.id]: 5000, [payer.id]: -5000 });
      const responses = await Promise.all([first, second].map(context =>
        context.request.patch(`/api/settle/${seed.settlementId}/status`, { data: { status: 'CONFIRMED' } })));
      const after = await first.request.get(balanceUrl);
      expect(after.status()).toBe(200);
      expect((await after.json()).balances).toEqual({ [receiver.id]: 0, [payer.id]: 0 });
      const [persisted] = await db.query('SELECT status, amount FROM Settlement WHERE id = ?', [seed.settlementId]);
      expect(persisted.status).toBe('CONFIRMED');
      expect(persisted.amount).toBe(5000);
      const transactions = await db.query('SELECT id FROM LedgerTransaction WHERE settlementId = ?', [seed.settlementId]);
      expect(transactions).toHaveLength(1);
      const entries = await db.query('SELECT amount FROM LedgerEntry WHERE transactionId = ? ORDER BY amount', [transactions[0].id]);
      expect(entries.map((entry: { amount: number }) => entry.amount)).toEqual([-5000, 5000]);
      expect(responses.map(response => response.status()).sort()).toEqual([200, 400]);
    } finally {
      await first.close();
      await second.close();
    }
  }
});

for (const limit of ['invite uses', 'space capacity'] as const) {
  test(`simultaneous claimants cannot exceed the last ${limit} slot`, async ({ request, newContext }) => {
    for (let round = 0; round < REPETITIONS; round++) {
      const seed = await seedScenario(request, 'invite-edge-cases');
      const owner = await session(newContext, seed.owner as User);
      const first = await session(newContext, seed.outsider1 as User);
      const second = await session(newContext, seed.outsider2 as User);
      try {
        let groupId = seed.coupleId as string;
        const initialMembers = limit === 'invite uses' ? 2 : 1;
        if (limit !== 'invite uses') {
          const created = await owner.request.post('/api/spaces', { data: { name: `Cap race ${round}`, type: 'COUPLE' } });
          expect(created.status()).toBe(200);
          const { space } = await created.json();
          groupId = space.id;
        }
        const one = await invite(owner.request, groupId, 1);
        // Different invite rows expose the shared space cap independently of maxUses.
        const two = limit !== 'invite uses' ? await invite(owner.request, groupId, 1) : one;
        const responses = await Promise.all([
          first.request.post('/api/invites/claim', { data: { token: one.token } }),
          second.request.post('/api/invites/claim', { data: { token: two.token } }),
        ]);
        const memberships = await db.query("SELECT userId FROM Membership WHERE groupId = ? AND status = 'ACTIVE'", [groupId]);
        expect(memberships).toHaveLength(initialMembers + 1);
        const claimantIds = [(seed.outsider1 as User).id, (seed.outsider2 as User).id];
        expect(memberships.filter((member: { userId: string }) => claimantIds.includes(member.userId))).toHaveLength(1);
        const invites = await db.query('SELECT usedCount, maxUses FROM GroupInvite WHERE id IN (?, ?)', [one.invite.id, two.invite.id]);
        expect(invites.reduce((total: number, row: { usedCount: number }) => total + row.usedCount, 0)).toBe(1);
        for (const row of invites) expect(row.usedCount).toBeLessThanOrEqual(row.maxUses);
        expect(responses.map(response => response.status()).sort()).toEqual([200, 400]);
        const loser = responses.find(response => response.status() === 400)!;
        expect((await loser.json()).code).toBe(limit === 'invite uses' ? 'EXHAUSTED' : 'SPACE_FULL');
        for (let index = 0; index < 2; index++) {
          const spaces = await [first, second][index].request.get('/api/spaces');
          expect(spaces.status()).toBe(200);
          expect((await spaces.json()).spaces.some((space: { id: string }) => space.id === groupId))
            .toBe(responses[index].status() === 200);
        }
      } finally {
        await owner.close();
        await first.close();
        await second.close();
      }
    }
  });
}

for (const limit of ['invite uses', 'space capacity'] as const) {
  test(`simultaneous guests cannot exceed the last ${limit} slot or leave orphan users`, async ({ request, newContext, playwright }) => {
    for (let round = 0; round < REPETITIONS; round++) {
      const seed = await seedScenario(request, 'invite-edge-cases');
      const owner = await session(newContext, seed.owner as User);
      const first = await newContext();
      const second = await newContext();
      try {
        const created = await owner.request.post('/api/spaces', { data: { name: `Guest race ${round}`, type: 'EPHEMERAL' } });
        expect(created.status()).toBe(200);
        const groupId = (await created.json()).space.id;
        const response = await owner.request.post(`/api/spaces/${groupId}/invites`, { data: { kind: 'GUEST', maxUses: limit === 'invite uses' ? 1 : 20 } });
        expect(response.status()).toBe(200);
        const { token, invite: link } = await response.json();
        // Fill through the real guest endpoint, one fresh cookie jar per guest:
        // a device that already holds a guest session of this trip is not
        // re-minted (the claim answers alreadyMember), so reusing one jar would
        // not add guests.
        const initialGuests = limit === 'invite uses' ? 0 : 18;
        for (let index = 0; index < initialGuests; index++) {
          const device = await playwright.request.newContext({ baseURL: process.env.TEST_BASE_URL });
          const fill = await device.post('/api/invites/claim', { data: { token, name: `Existing ${round}-${index}` } });
          expect(fill.status()).toBe(200);
          await device.dispose();
        }
        const beforeUsers = await db.query('SELECT id FROM User WHERE isGuest = true');
        const results = await Promise.all([first, second].map((context, index) =>
          context.request.post('/api/invites/claim', { data: { token, name: `Contender ${round}-${index}` } })));
        const members = await db.query("SELECT role FROM Membership WHERE groupId = ? AND status = 'ACTIVE'", [groupId]);
        expect(members).toHaveLength(initialGuests + 2);
        expect(members.filter((member: { role: string }) => member.role === 'GUEST')).toHaveLength(initialGuests + 1);
        const afterUsers = await db.query('SELECT id FROM User WHERE isGuest = true');
        expect(afterUsers).toHaveLength(beforeUsers.length + 1);
        const [persisted] = await db.query('SELECT usedCount, maxUses FROM GroupInvite WHERE id = ?', [link.id]);
        expect(persisted.usedCount).toBe(initialGuests + 1);
        expect(persisted.usedCount).toBeLessThanOrEqual(persisted.maxUses);
        expect(results.map(result => result.status()).sort()).toEqual([200, 400]);
        expect((await results.find(result => result.status() === 400)!.json()).code)
          .toBe(limit === 'invite uses' ? 'EXHAUSTED' : 'SPACE_FULL');
      } finally {
        await owner.close();
        await first.close();
        await second.close();
      }
    }
  });
}
