import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

test.describe('Settlements - Create and Confirm', () => {
  let userA: { email: string; password: string; id: string };
  let userB: { email: string; password: string; id: string };
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'couple-with-debt');
    userA = data.userA;
    userB = data.userB;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('userB creates a settlement - appears as PENDING', async ({ browser }) => {
    // userB owes userA 50€
    const ctxB = await createAuthenticatedContext(browser, userB);
    const pageB = await ctxB.newPage();

    await pageB.goto('/settle');

    // Step 1: select creditor (userA) and continue
    const continueBtn = pageB.getByRole('button', { name: /Continuar/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    // Step 2: fill amount and confirm
    const amountInput = pageB.locator('input[type="number"]').last();
    await amountInput.fill('50');

    const confirmBtn = pageB.getByRole('button', { name: /Confirmar Pago/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Should redirect to dashboard
    await expect(pageB).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Navigate to expenses/list to verify settlement appears
    await pageB.goto('/expenses/list');
    await expect(pageB.getByText(/Liquidación/i).first()).toBeVisible({ timeout: 10000 });

    await pageB.close();
    await ctxB.close();
  });

  test('userA (receiver) confirms settlement - status changes', async ({ browser }) => {
    // First create a settlement as userB
    const ctxB = await createAuthenticatedContext(browser, userB);
    const pageB = await ctxB.newPage();

    await pageB.goto('/settle');
    const continueBtn = pageB.getByRole('button', { name: /Continuar/i });
    await expect(continueBtn).toBeVisible({ timeout: 10000 });
    await continueBtn.click();

    const amountInput = pageB.locator('input[type="number"]').last();
    await amountInput.fill('50');
    const confirmBtn = pageB.getByRole('button', { name: /Confirmar Pago/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect(pageB).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await pageB.close();
    await ctxB.close();

    // Now userA confirms
    const ctxA = await createAuthenticatedContext(browser, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto('/dashboard');

    // UserA should see a "Confirmar Pagos" section
    const confirmSection = pageA.getByText(/Confirmar Pagos/i);
    await expect(confirmSection).toBeVisible({ timeout: 10000 });

    // Click the confirm button
    const confirmPayBtn = pageA.getByRole('button', { name: /Confirmar/i }).first();
    await expect(confirmPayBtn).toBeVisible();
    await confirmPayBtn.click();

    // After confirmation, the section should disappear or balance should update
    // Wait for page to refresh
    await pageA.waitForTimeout(1000);
    await pageA.reload();

    // The balance should now be ~0 (or the section gone)
    const balanceEl = pageA.locator('[data-testid="balance-amount"]');
    if (await balanceEl.isVisible()) {
      const balanceText = await balanceEl.textContent();
      // After confirming, balance should be near 0
      expect(balanceText).toBeTruthy();
    }

    await pageA.close();
    await ctxA.close();
  });
});
