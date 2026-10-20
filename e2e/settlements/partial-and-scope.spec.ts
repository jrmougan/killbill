import type { BrowserContext } from '@playwright/test';
import mariadb from 'mariadb';
import { test, expect, type NewContext } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

/** UI side of the saldar.md fixes: S-03/S-11, S-04, S-05, S-07/S-18, S-09. */

const db = mariadb.createPool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT) || 3306,
  user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, connectionLimit: 2,
});

type User = { id: string; email: string; password: string };
const contexts: BrowserContext[] = [];
async function as(newContext: NewContext, user: User) {
  const ctx = await createAuthenticatedContext(newContext, user);
  contexts.push(ctx);
  return ctx;
}

test.describe('Settlements - partial payments, explicit space, archived, edit', () => {
  // Several first-time page compiles per test on the dev server.
  test.describe.configure({ timeout: 60_000 });
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close())); });
  test.afterAll(async () => { await db.end(); });

  test('RV-01: a 409 closes the /settle sheet and reopening it shows the edited amount', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const A = seed.userA as User; const B = seed.userB as User;
    const ctxB = await as(newContext, B);
    const created = await ctxB.request.post('/api/settle', { data: { toUserId: A.id, amount: 20, method: 'BIZUM' } });
    const id = (await created.json()).settlement.id as string;

    const page = await (await as(newContext, A)).newPage();
    await page.goto('/settle');
    await page.getByRole('button', { name: /^Sí, he recibido 20,00\s€ de User B/ }).click();
    const sheet = page.getByTestId('confirm-settlement-sheet');
    await expect(sheet).toContainText(/User B aún te deberá 30,00\s€/);
    // The debtor lowers the payment while the creditor's sheet is open.
    expect((await ctxB.request.patch(`/api/settle/${id}`, { data: { amount: 15 } })).status()).toBe(200);
    await page.getByTestId('confirm-sheet-confirm').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('settle-error')).toBeVisible();
    await page.getByRole('button', { name: /^Sí, he recibido 15,00\s€ de User B/ }).click();
    await expect(sheet).toContainText(/User B aún te deberá 35,00\s€/);
    await expect(page.getByTestId('settle-error')).toHaveCount(0);
  });

  test('S-03/S-11: confirming a partial payment keeps the remaining debt and the ticket explains it', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const A = seed.userA as User; const B = seed.userB as User;
    const ctxB = await as(newContext, B);
    expect((await ctxB.request.post('/api/settle', { data: { toUserId: A.id, amount: 20, method: 'BIZUM' } })).status()).toBe(200);

    const page = await (await as(newContext, A)).newPage();
    await page.goto('/settle');
    const patch = page.waitForResponse((r) => /\/api\/settle\/[^/]+\/status$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: /^Sí, he recibido .* de User B/ }).click();
    // Same review sheet as "Lo he recibido" on Inicio.
    await expect(page.getByTestId('confirm-settlement-sheet')).toContainText(/User B aún te deberá 30,00\s€/);
    await page.getByTestId('confirm-sheet-confirm').click();
    const res = await patch;
    expect(res.ok()).toBeTruthy();
    expect(res.request().postDataJSON()).toEqual({ status: 'CONFIRMED', expectedAmountCents: 2000 });

    const done = page.getByTestId('settle-peace');
    await expect(done).toContainText(/Pago registrado · aún te debe 30,00\s*€/);
    await expect(done).not.toContainText('Deuda saldada');
    await page.getByRole('button', { name: 'Saldar el resto' }).click();

    // The ticket still lists the expense that explains the debt, plus the payment.
    await expect(page.getByTestId('settle-balance')).toHaveText(/30,00\s*€/);
    await expect(page.getByTestId('settle-ticket-meta')).toContainText('1 GASTO');
    await expect(page.getByTestId('settle-ticket-payments')).toContainText(/Pagos recibidos\s*−20,00\s*€/);
    await expect(page.getByTestId('settle-ticket-carry')).toHaveCount(0);
  });

  test('CF-10: a partial payment of 20 € from the review sheet leaves the rest owed; above the max is an inline error', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const B = seed.userB as User;
    const page = await (await as(newContext, seed.userA as User)).newPage();
    const posts: unknown[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/settle' && r.method() === 'POST') posts.push(r.postDataJSON()); });
    await page.goto('/settle');
    await page.getByRole('button', { name: /^User B ya me ha pagado 50,00\s€$/ }).click();

    const amount = page.getByTestId('settle-review-amount');
    await expect(amount).toHaveValue('50,00');
    await expect(page.getByTestId('settle-review-sheet')).toContainText(/máx\. 50,00\s€/);
    await amount.fill('60');
    await expect(page.getByTestId('settle-review-amount-error')).toContainText(/No puede ser más de 50,00\s€/);
    await expect(page.getByTestId('confirm-sheet-confirm')).toBeDisabled();
    expect(posts).toEqual([]);

    await amount.fill('20');
    await expect(page.getByTestId('settle-review-sheet')).toContainText(/User B aún te deberá 30,00\s€/);
    await expect(page.getByRole('dialog', { name: /¿Has recibido 20,00\s€ de User B\?/ })).toBeVisible();
    const post = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/settle' && r.request().method() === 'POST');
    await page.getByTestId('confirm-sheet-confirm').click();
    const res = await post;
    expect(res.ok()).toBeTruthy();
    expect(res.request().postDataJSON()).toMatchObject({ fromUserId: B.id, amount: 20 });
    await expect(page.getByTestId('settle-peace')).toContainText(/Pago registrado · aún te debe 30,00\s*€/);
    expect(posts).toHaveLength(1);
  });

  test('opening /settle with nothing owed says "al día", never "Deuda saldada"', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-no-expenses');
    const page = await (await as(newContext, seed.userA as User)).newPage();
    await page.goto('/settle');
    await expect(page.getByRole('heading', { level: 1, name: 'Saldar deuda' })).toBeVisible();
    const peace = page.getByTestId('settle-peace');
    await expect(peace).toContainText('Estáis al día');
    await expect(peace).not.toContainText('Deuda saldada');
  });

  test('S-05: /settle?space= shows that space even when another one is active', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const A = seed.userA as User; const g = seed.coupleId as string;
    const ctx = await as(newContext, A);
    // Creating a space makes it the active one.
    expect((await ctx.request.post('/api/spaces', { data: { name: 'Piso Nuevo', type: 'GROUP' } })).status()).toBe(200);

    const page = await ctx.newPage();
    await page.goto('/settle');
    await expect(page.getByTestId('settle-peace')).toContainText('Piso Nuevo');

    await page.goto(`/settle?space=${g}`);
    await expect(page.getByTestId('settle-ticket')).toContainText('Cuenta de Debt Couple');
    await expect(page.getByTestId('settle-balance')).toHaveText(/50,00\s*€/);
    await expect(page.getByRole('link', { name: 'Historial' })).toHaveAttribute('href', `/settle/history?space=${g}`);
    await page.goto(`/settle/history?space=${g}`);
    await expect(page.getByText('Debt Couple').first()).toBeVisible();

    // A space the user does not belong to is never shown.
    await page.goto('/settle?space=not-a-real-space');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('S-07/S-18: an ARCHIVED space hides Editar and the confirm buttons', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'space-settling');
    const A = seed.userA as User; const B = seed.userB as User;
    await db.query("UPDATE Couple SET status = 'ARCHIVED' WHERE id = ?", [seed.coupleId]);

    const pageB = await (await as(newContext, B)).newPage();
    await pageB.goto(`/settle/${seed.settlementId}`);
    await expect(pageB.getByTestId('settlement-amount')).toHaveText(/50,00\s*€/);
    await expect(pageB.getByText(/archivado/)).toBeVisible();
    await expect(pageB.getByRole('link', { name: 'Editar' })).toHaveCount(0);

    const pageA = await (await as(newContext, A)).newPage();
    await pageA.goto(`/settle/${seed.settlementId}`);
    await expect(pageA.getByTestId('settlement-amount')).toBeVisible();
    await expect(pageA.getByRole('button', { name: /recibido|Rechazar el pago/ })).toHaveCount(0);
  });

  test('S-09: the edit screen parses es-ES amounts strictly and shows errors', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-pending-settlement');
    const B = seed.userB as User; const id = seed.settlementId as string;
    const page = await (await as(newContext, B)).newPage();
    await page.goto(`/settle/${id}/edit`);
    const input = page.getByLabel(/Importe pagado a/);
    const save = page.getByRole('button', { name: 'Guardar cambios' });
    await expect(page.getByText(/^máx\. 50,00\s€$/)).toBeVisible();
    await expect(page.getByTestId('settle-edit-notice')).toHaveText('User A tendrá que confirmar el nuevo importe.');

    for (const bad of ['abc', '0,004', '1.2.3', '0']) {
      await input.fill(bad);
      await expect(page.getByTestId('settle-amount-error')).toBeVisible();
      await expect(save).toBeDisabled();
    }

    // "1.000,50" is 1.000,50 € (not 1 €): above the 50 € debt → inline error
    // (the cap is the "máx." under the field), nothing reaches the API.
    await input.fill('1.000,50');
    await expect(page.getByTestId('settle-amount-error')).toHaveText(/No puede ser más de 50,00\s€/);
    await expect(save).toBeDisabled();

    await input.fill('12,50');
    await save.click();
    await expect(page).toHaveURL(new RegExp(`/settle/${id}$`));
    await expect(page.getByTestId('settlement-amount')).toHaveText(/12,50\s*€/);
  });

  test('S-04: a guest owed money confirms the payment from /settle', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'ephemeral-with-guest');
    const owner = seed.owner as User; const guest = seed.guest as { id: string; sessionToken: string };
    const guestCtx = await newContext();
    contexts.push(guestCtx);
    await guestCtx.addCookies([{ name: 'session_token', value: guest.sessionToken, url: process.env.TEST_BASE_URL || 'http://localhost:3000' }]);
    // Guest pays 100 € → the owner owes the guest 20 €; the owner says "Ya he pagado".
    expect((await guestCtx.request.post('/api/expenses', { data: { description: 'Peaje', amount: 100, category: 'other' } })).status()).toBe(200);
    const ownerCtx = await as(newContext, owner);
    expect((await ownerCtx.request.post('/api/settle', { data: { toUserId: guest.id, amount: 20 } })).status()).toBe(200);

    const page = await guestCtx.newPage();
    await page.goto('/settle');
    const confirm = page.getByRole('button', { name: /^Sí, he recibido 20,00\s€ de / });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await page.getByTestId('confirm-sheet-confirm').click();
    await expect(page.getByTestId('settle-peace')).toContainText('Deuda saldada');
  });
});
