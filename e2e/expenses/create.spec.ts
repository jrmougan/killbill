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

  // The add-expense flow is a 2-step wizard: step 1 = amount (+ keypad / scan),
  // step 2 = details (description, category, split). "Siguiente" advances; "Guardar gasto" submits.

  test('create expense with description and amount - appears in expense list', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    // Step 1: amount
    await page.fill('[data-testid="expense-amount"]', '25.50');
    await page.click('[data-testid="expense-next"]');
    // Step 2: details
    await page.fill('[data-testid="expense-description"]', 'Test E2E Expense');
    await page.click('[data-testid="expense-submit"]');

    // Should redirect to dashboard after saving
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Navigate to expenses list and verify the expense appears
    await page.goto('/expenses/list');
    await expect(page.getByText('Test E2E Expense')).toBeVisible({ timeout: 10000 });
  });

  test('amount 0 - next button is disabled (cannot reach details)', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    await page.fill('[data-testid="expense-amount"]', '0');

    // The "Siguiente" button gates the amount step; with 0 it must be disabled.
    const nextBtn = page.locator('[data-testid="expense-next"]');
    await expect(nextBtn).toBeDisabled();
  });

  test('empty description - submit button is disabled', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    // Step 1: provide a valid amount and advance
    await page.fill('[data-testid="expense-amount"]', '15.00');
    await page.click('[data-testid="expense-next"]');

    // Step 2: leave description empty -> Guardar must be disabled
    const submitBtn = page.locator('[data-testid="expense-submit"]');
    await expect(submitBtn).toBeDisabled();
  });
});
