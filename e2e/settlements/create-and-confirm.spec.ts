import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

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

  test('userB creates a settlement - appears as PENDING', async ({ newContext }) => {
    // Seed isolated scenario: userB owes userA 50€
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };

    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    const pageErrors: string[] = [];
    pageB.on('pageerror', (error) => pageErrors.push(error.message));

    await pageB.goto('/settle');

    // Step 1: select creditor (userA) and continue
    const continueBtn = pageB.getByRole('button', { name: /Continuar/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // Step 2: fill amount using accessible label and submit
    const amountInput = pageB.getByLabel(/importe/i);
    await expect(amountInput).toBeVisible({ timeout: 10000 });
    await amountInput.fill('50');

    const confirmBtn = pageB.getByRole('button', { name: /Confirmar Pago/i });
    await expect(confirmBtn).toBeEnabled();

    const settleResponsePromise = pageB.waitForResponse(
      (res) => res.url().includes('/api/settle') && res.request().method() === 'POST'
    );
    await confirmBtn.click();
    const settleResponse = await settleResponsePromise;
    expect(settleResponse.ok()).toBeTruthy();

    // Should redirect to dashboard
    await expect(pageB).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Navigate to expenses/list to verify settlement appears as PENDING with exact amount
    await pageB.goto('/expenses/list');
    const settlementCard = pageB.locator('a[href^="/settle/"]', { hasText: 'Liquidación' }).first();
    await expect(settlementCard).toBeVisible({ timeout: 10000 });
    await expect(settlementCard).toContainText(/50,00\s*€/);
    await expect(settlementCard).toContainText('Pendiente');
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
    expect(pageErrors, 'el acreedor debe ver el pago pendiente sin errores del navegador').toEqual([]);

    await pageA.close();
    await ctxA.close();
  });

  test('userA (receiver) confirms settlement - status changes', async ({ newContext }) => {
    // Seed isolated scenario: couple with an existing 50€ pending settlement from userB to userA
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-pending-settlement');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };

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

    await pageB.close();
    await ctxB.close();
  });
});
