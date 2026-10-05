import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

type Creds = { email: string; password: string; id: string };

test.describe('Settlements - Create and Confirm', () => {
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('userB (debtor) says "Ya he pagado" - settlement stays PENDING', async ({ newContext }) => {
    // Seed isolated scenario: userB owes userA 50€
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as Creds;
    const userB = data.userB as Creds;

    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    const pageErrors: string[] = [];
    pageB.on('pageerror', (error) => pageErrors.push(error.message));

    await pageB.goto('/settle');

    // Receipt ticket: the debtor sees what they owe and to whom.
    const ticket = pageB.getByTestId('settle-ticket');
    await expect(ticket).toBeVisible({ timeout: 10000 });
    await expect(ticket).toContainText('Cuenta de Debt Couple');
    await expect(ticket).toContainText('Le debes a User A');
    await expect(pageB.getByTestId('settle-ticket-meta')).toContainText('1 GASTO');
    await expect(pageB.getByTestId('settle-balance')).toHaveText(/50,00\s*€/);

    // Method is a radio group; pick Transferencia.
    await pageB.getByRole('radio', { name: 'Transferencia' }).check();
    await expect(pageB.getByRole('radio', { name: 'Transferencia' })).toBeChecked();

    const settleResponsePromise = pageB.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST'
    );
    await pageB.getByRole('button', { name: 'Ya he pagado' }).click();
    const settleResponse = await settleResponsePromise;
    expect(settleResponse.ok()).toBeTruthy();
    expect(settleResponse.request().postDataJSON()).toMatchObject({ toUserId: userA.id, amount: 50, method: 'TRANSFER' });

    // Two-step confirmation: the debtor sees it as pending on the creditor.
    await expect(pageB.getByTestId('settle-pending')).toContainText('Pendiente de que User A confirme');

    // Navigate to expenses/list to verify settlement appears as PENDING with exact amount
    await pageB.goto('/expenses/list');
    const settlementCard = pageB.locator('a[href^="/settle/"]', { hasText: 'Liquidación' }).first();
    await expect(settlementCard).toBeVisible({ timeout: 10000 });
    await expect(settlementCard).toContainText(/50,00\s*€/);
    await expect(settlementCard).toContainText('Pendiente');

    // Back on /settle the debt is still there (PENDING does not move balances),
    // but a second "Ya he pagado" is not offered for the same transfer.
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-balance')).toHaveText(/50,00\s*€/);
    await expect(pageB.getByTestId('settle-outgoing-pending')).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Ya he pagado' })).toHaveCount(0);
    expect(pageErrors, 'el flujo de liquidación debe hidratar sin errores del navegador').toEqual([]);

    await pageB.close();
    await ctxB.close();

    // Verify receiver (userA, creditor) sees the pending settlement on their dashboard
    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();
    pageA.on('pageerror', (error) => pageErrors.push(error.message));
    await pageA.goto('/dashboard');
    const confirmSection = pageA.getByText(/Confirmar Pagos/i);
    await expect(confirmSection).toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText(/User B te ha pagado/i)).toBeVisible();
    await expect(pageA.getByText(/50\.00\s*€/)).toBeVisible();

    // ...and on /settle the creditor confirms the pending one instead of a new "Ya me ha pagado".
    await pageA.goto('/settle');
    await expect(pageA.getByRole('button', { name: 'Confirmar pago de User B' })).toBeVisible();
    await expect(pageA.getByRole('button', { name: 'Ya me ha pagado' })).toHaveCount(0);
    expect(pageErrors, 'el acreedor debe ver el pago pendiente sin errores del navegador').toEqual([]);

    await pageA.close();
    await ctxA.close();
  });

  test('userA (receiver) confirms settlement - status changes', async ({ newContext }) => {
    // Seed isolated scenario: couple with an existing 50€ pending settlement from userB to userA
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-pending-settlement');
    const userA = data.userA as Creds;
    const userB = data.userB as Creds;

    // Creditor / receiver (userA) confirms the settlement from dashboard
    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto('/dashboard');

    // UserA should see positive balance (+50,00 €) and a "Confirmar Pagos" section
    const balanceElA = pageA.locator('[data-testid="balance-amount"]');
    await expect(balanceElA).toHaveText(/\+50,00\s*€/, { timeout: 10000 });

    const confirmSection = pageA.getByText(/Confirmar Pagos/i);
    await expect(confirmSection).toBeVisible({ timeout: 10000 });

    // Click confirm button and wait for PATCH response
    const confirmPayBtn = pageA.getByRole('button', { name: /Confirmar/i }).first();
    await expect(confirmPayBtn).toBeVisible({ timeout: 10000 });

    const patchResponsePromise = pageA.waitForResponse(
      (res) => res.url().includes('/api/settle/') && res.url().includes('/status') && res.request().method() === 'PATCH'
    );
    await confirmPayBtn.click();
    const patchResponse = await patchResponsePromise;
    expect(patchResponse.ok()).toBeTruthy();

    // After confirmation, the section disappears
    await expect(confirmSection).not.toBeVisible({ timeout: 10000 });

    // UserA's balance must now be 0,00 €
    await expect(balanceElA).toHaveText(/0,00\s*€/, { timeout: 10000 });

    // Verify settlement in expenses/list shows CONFIRMED ('Confirmado') and exact amount
    await pageA.goto('/expenses/list');
    const settlementCardA = pageA.locator('a[href^="/settle/"]', { hasText: 'Liquidación' }).first();
    await expect(settlementCardA).toBeVisible({ timeout: 10000 });
    await expect(settlementCardA).toContainText(/50,00\s*€/);
    await expect(settlementCardA).toContainText('Confirmado');

    await pageA.close();
    await ctxA.close();

    // Verify debtor / payer (userB) in a separate browser context: balance settled to 0,00 €
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();

    await pageB.goto('/dashboard');
    const balanceElB = pageB.locator('[data-testid="balance-amount"]');
    await expect(balanceElB).toHaveText(/0,00\s*€/, { timeout: 10000 });

    // Verify settlement in expenses/list also shows CONFIRMED for userB
    await pageB.goto('/expenses/list');
    const settlementCardB = pageB.locator('a[href^="/settle/"]', { hasText: 'Liquidación' }).first();
    await expect(settlementCardB).toBeVisible({ timeout: 10000 });
    await expect(settlementCardB).toContainText(/50,00\s*€/);
    await expect(settlementCardB).toContainText('Confirmado');

    // And /settle tells the debtor they are at peace.
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-peace')).toContainText('Estáis en paz');
    await expect(pageB.getByTestId('settle-peace')).toContainText('No hay nada pendiente en Settlement Couple');

    await pageB.close();
    await ctxB.close();
  });

  test('creditor confirms from /settle/[id] detail', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-pending-settlement');
    const userA = data.userA as Creds;
    const userB = data.userB as Creds;
    const settlementId = data.settlementId as string;

    // The debtor sees the detail as pending, without confirm actions but with Editar.
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto(`/settle/${settlementId}`);
    await expect(pageB.getByTestId('settlement-amount')).toHaveText(/50,00\s*€/);
    await expect(pageB.getByText('Pendiente de que User A confirme.', { exact: false })).toBeVisible();
    await expect(pageB.getByRole('button', { name: /Confirmar/ })).toHaveCount(0);
    await expect(pageB.getByRole('link', { name: 'Editar' })).toBeVisible();
    await ctxB.close();

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();
    await pageA.goto(`/settle/${settlementId}`);
    await expect(pageA.getByText('User B te pagó')).toBeVisible();
    const patch = pageA.waitForResponse(
      (res) => res.url().endsWith(`/api/settle/${settlementId}/status`) && res.request().method() === 'PATCH'
    );
    await pageA.getByRole('button', { name: 'Confirmar, lo he recibido' }).click();
    expect((await patch).ok()).toBeTruthy();
    await expect(pageA.locator('[data-status="CONFIRMED"]')).toHaveText('Confirmado');
    await expect(pageA.getByRole('button', { name: /Confirmar/ })).toHaveCount(0);

    // History lists it as confirmed.
    await pageA.goto('/settle/history');
    const row = pageA.getByTestId('settle-history-row').first();
    await expect(row).toHaveAttribute('data-status', 'CONFIRMED');
    await expect(row).toContainText('User B te pagó');
    await ctxA.close();
  });

  test('creditor says "Ya me ha pagado" - confirmed at once, both at peace', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as Creds;
    const userB = data.userB as Creds;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();
    await pageA.goto('/settle');
    await expect(pageA.getByTestId('settle-ticket')).toContainText('User B te debe');
    await expect(pageA.getByTestId('settle-balance')).toHaveText(/50,00\s*€/);
    await expect(pageA.getByRole('button', { name: 'Recordárselo a User B' })).toBeVisible();

    await pageA.getByRole('radio', { name: 'Efectivo' }).check();
    const post = pageA.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST'
    );
    await pageA.getByRole('button', { name: 'Ya me ha pagado' }).click();
    const res = await post;
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).settlement.status).toBe('CONFIRMED');

    const peace = pageA.getByTestId('settle-peace');
    await expect(peace).toContainText('Estáis en paz');
    await expect(peace).toContainText('Pago registrado en efectivo');

    await pageA.goto('/dashboard');
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/, { timeout: 10000 });
    await ctxA.close();

    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-peace')).toContainText('Estáis en paz');
    await ctxB.close();
  });

  test('group: pairwise transfers that involve me', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'group-of-3');
    const userA = data.userA as Creds;
    const userB = data.userB as Creds;

    // Creditor A: owed by B and C.
    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();
    await pageA.goto('/settle');
    await expect(pageA.getByTestId('settle-ticket')).toContainText('Te deben');
    await expect(pageA.getByTestId('settle-ticket')).toContainText('A cada uno (÷3)');
    await expect(pageA.getByTestId('settle-balance')).toHaveText(/66,66\s*€|66,67\s*€/);
    const transfers = pageA.getByTestId('settle-transfers').getByRole('radio');
    await expect(transfers).toHaveCount(2);
    await expect(pageA.getByRole('button', { name: 'Recordárselo al grupo' })).toBeVisible();
    await ctxA.close();

    // Debtor B: a single transfer to A.
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-ticket')).toContainText('Debes');
    await expect(pageB.getByRole('radio', { name: /Pagas a User A: 33,33/ })).toBeChecked();
    const post = pageB.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST'
    );
    await pageB.getByRole('button', { name: 'Ya he pagado' }).click();
    const res = await post;
    expect(res.ok()).toBeTruthy();
    expect(res.request().postDataJSON()).toMatchObject({ toUserId: userA.id, amount: 33.33 });
    await expect(pageB.getByTestId('settle-pending')).toContainText('Pendiente de que User A confirme');
    await ctxB.close();
  });
});
