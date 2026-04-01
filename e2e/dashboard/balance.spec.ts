import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Dashboard - Balance', () => {
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

  test('userA has positive balance with couple-with-debt scenario', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA;

    await loginAs(page, userA);
    await expect(page).toHaveURL(/\/dashboard/);

    const balance = page.locator('[data-testid="balance-amount"]');
    await expect(balance).toBeVisible({ timeout: 10000 });

    const balanceText = await balance.textContent();
    // userA paid 100€ and split 50/50, so they are owed 50€ → positive balance
    expect(balanceText).toContain('+');
  });

  test('userB has negative balance with couple-with-debt scenario', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userB = data.userB;

    await loginAs(page, userB);
    await expect(page).toHaveURL(/\/dashboard/);

    const balance = page.locator('[data-testid="balance-amount"]');
    await expect(balance).toBeVisible({ timeout: 10000 });

    const balanceText = await balance.textContent();
    // userB owes 50€, so negative balance - no "+" sign
    expect(balanceText).not.toContain('+');
    // Should be negative (either no prefix or with an amount that implies debt)
    const amount = parseFloat(balanceText?.replace('€', '').trim() || '0');
    expect(amount).toBeLessThan(0);
  });

  test('pending settlement is visible on dashboard for receiver (userA)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-pending-settlement');
    const userA = data.userA;

    await loginAs(page, userA);
    await expect(page).toHaveURL(/\/dashboard/);

    // UserA is the receiver of the pending settlement - should see "Confirmar Pagos"
    const confirmSection = page.getByText(/Confirmar Pagos/i);
    await expect(confirmSection).toBeVisible({ timeout: 10000 });
  });
});
