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

  test('S-03/S-11: confirming a partial payment keeps the remaining debt and the ticket explains it', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const A = seed.userA as User; const B = seed.userB as User;
    const ctxB = await as(newContext, B);
    expect((await ctxB.request.post('/api/settle', { data: { toUserId: A.id, amount: 20, method: 'BIZUM' } })).status()).toBe(200);

    const page = await (await as(newContext, A)).newPage();
    await page.goto('/settle');
    const patch = page.waitForResponse((r) => /\/api\/settle\/[^/]+\/status$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: 'Confirmar pago de User B' }).click();
    const res = await patch;
    expect(res.ok()).toBeTruthy();
    expect(res.request().postDataJSON()).toEqual({ status: 'CONFIRMED', expectedAmountCents: 2000 });

    const done = page.getByTestId('settle-peace');
    await expect(done).toContainText('Pago registrado');
    await expect(done).not.toContainText('Estáis en paz');
    await expect(done).toContainText(/Aún te debe 30,00\s*€/);
    await page.getByRole('button', { name: 'Seguir saldando' }).click();

    // The ticket still lists the expense that explains the debt, plus the payment.
    await expect(page.getByTestId('settle-balance')).toHaveText(/30,00\s*€/);
    await expect(page.getByTestId('settle-ticket-meta')).toContainText('1 GASTO');
    await expect(page.getByTestId('settle-ticket-payments')).toContainText(/Pagos recibidos\s*−20,00\s*€/);
    await expect(page.getByTestId('settle-ticket-carry')).toHaveCount(0);
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
    await expect(pageA.getByRole('button', { name: /Confirmar|Rechazar/ })).toHaveCount(0);
  });

  test('S-09: the edit screen parses es-ES amounts strictly and shows errors', async ({ request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-pending-settlement');
    const B = seed.userB as User; const id = seed.settlementId as string;
    const page = await (await as(newContext, B)).newPage();
    await page.goto(`/settle/${id}/edit`);
    const input = page.getByLabel(/Importe pagado a/);
    const save = page.getByRole('button', { name: 'Guardar cambios' });

    for (const bad of ['abc', '0,004', '1.2.3', '0']) {
      await input.fill(bad);
      await expect(page.getByTestId('settle-amount-error')).toBeVisible();
      await expect(save).toBeDisabled();
    }

    // "1.000,50" is 1.000,50 € (not 1 €): above the 50 € debt → the API refuses it.
    await input.fill('1.000,50');
    await expect(save).toBeEnabled();
    const patch = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/settle/${id}` && r.request().method() === 'PATCH');
    await save.click();
    const res = await patch;
    expect(res.request().postDataJSON()).toMatchObject({ amount: 1000.5 });
    expect(res.status()).toBe(409);
    await expect(page.getByText(/supera la deuda pendiente/)).toBeVisible();

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
    const confirm = page.getByRole('button', { name: /^Confirmar pago de/ });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page.getByTestId('settle-peace')).toContainText('Estáis en paz');
  });
});
