import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Expenses - Create', () => {
  let userA: { email: string; password: string; id: string };
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    userA = data.userA;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('create expense with description and amount - appears in expense list', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    await page.fill('[data-testid="expense-description"]', 'Test E2E Expense');
    await page.fill('[data-testid="expense-amount"]', '25.50');
    await page.click('[data-testid="expense-submit"]');

    // Should redirect to dashboard after saving
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Navigate to expenses list and verify the expense appears
    await page.goto('/expenses/list');
    await expect(page.getByText('Test E2E Expense')).toBeVisible({ timeout: 10000 });
  });

  test('amount 0 - submit button is disabled or validation error shown', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    await page.fill('[data-testid="expense-description"]', 'Zero Amount Test');
    await page.fill('[data-testid="expense-amount"]', '0');

    const submitBtn = page.locator('[data-testid="expense-submit"]');

    // Check if the button is disabled or if submitting shows a validation state
    const isDisabled = await submitBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      expect(isDisabled).toBeDefined();
    } else {
      // Try submitting - should not navigate away
      await submitBtn.click();
      // Should still be on the new expense page (HTML5 validation prevents submit)
      await expect(page).toHaveURL(/\/expenses\/new/);
    }
  });

  test('empty description - submit button is disabled or validation error', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    // Leave description empty, fill amount only
    await page.fill('[data-testid="expense-amount"]', '15.00');

    const submitBtn = page.locator('[data-testid="expense-submit"]');

    const isDisabled = await submitBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      expect(isDisabled).toBeDefined();
    } else {
      await submitBtn.click();
      // HTML5 required validation should prevent navigation
      await expect(page).toHaveURL(/\/expenses\/new/);
    }
  });
});
