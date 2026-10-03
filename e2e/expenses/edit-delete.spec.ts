import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

test.describe('Expenses - Edit and Delete', () => {
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

  test('editing the amount recalculates the balances exactly', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };
    const expenseId = data.expenseId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto(`/expense/${expenseId}/edit`);

    const amountInput = pageA.locator('#expense-amount');
    await expect(amountInput).toBeVisible({ timeout: 10000 });
    await amountInput.fill('200');

    const patchPromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'PATCH'
    );
    await pageA.getByRole('button', { name: /Guardar Cambios/i }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBeTruthy();

    // Back on the detail page: the total reflects the new amount (100€ -> 200€)
    await expect(pageA).toHaveURL(new RegExp(`/expense/${expenseId}$`), { timeout: 10000 });
    await expect(pageA.locator('h2')).toHaveText(/200,00\s*€/, { timeout: 10000 });

    // userA paid 200€ split 50/50 -> is owed 100€
    await pageA.goto('/dashboard');
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/\+100,00\s*€/, { timeout: 10000 });

    await pageA.close();
    await ctxA.close();

    // userB now owes 100€
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/dashboard');
    await expect(pageB.locator('[data-testid="balance-amount"]')).toHaveText(/-100,00\s*€/, { timeout: 10000 });

    await pageB.close();
    await ctxB.close();
  });

  test('deleting the expense zeroes the balances and removes it from the list', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };
    const expenseId = data.expenseId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto(`/expense/${expenseId}`);

    await pageA.locator('[data-testid="expense-delete"]').click();
    const deletePromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'DELETE'
    );
    await pageA.locator('[data-testid="expense-delete-confirm"]').click();
    const deleteResponse = await deletePromise;
    expect(deleteResponse.ok()).toBeTruthy();

    // Redirected to the dashboard; the balance is back to zero
    await expect(pageA).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/, { timeout: 10000 });

    // The expense no longer appears in the movements list
    await pageA.goto('/expenses/list');
    await expect(pageA.getByText('Test Expense')).not.toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText('Sin resultados')).toBeVisible();

    await pageA.close();
    await ctxA.close();

    // userB's balance is zeroed too
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/dashboard');
    await expect(pageB.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/, { timeout: 10000 });

    await pageB.close();
    await ctxB.close();
  });

  test('editing the payer inverts the balances', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };
    const expenseId = data.expenseId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto(`/expense/${expenseId}/edit`);

    // Switch the payer from userA ("Yo") to userB
    const payerB = pageA.locator(`[data-testid="edit-payer-${userB.id}"]`);
    await expect(payerB).toBeVisible({ timeout: 10000 });
    await payerB.click();
    await expect(payerB).toHaveAttribute('aria-pressed', 'true');

    const patchPromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'PATCH'
    );
    await pageA.getByRole('button', { name: /Guardar Cambios/i }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBeTruthy();

    // Detail page now attributes the payment to userB
    await expect(pageA).toHaveURL(new RegExp(`/expense/${expenseId}$`), { timeout: 10000 });
    await expect(pageA.getByText(/Pagado por/)).toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText('User B', { exact: true }).first()).toBeVisible();

    // Balances inverted: userA owes 50€
    await pageA.goto('/dashboard');
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/-50,00\s*€/, { timeout: 10000 });

    await pageA.close();
    await ctxA.close();

    // ...and userB is owed 50€
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/dashboard');
    await expect(pageB.locator('[data-testid="balance-amount"]')).toHaveText(/\+50,00\s*€/, { timeout: 10000 });

    await pageB.close();
    await ctxB.close();
  });

  test('promoting a personal expense shares it and it counts in the balances', async ({ newContext }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    const userA = data.userA as { email: string; password: string; id: string };
    const userB = data.userB as { email: string; password: string; id: string };
    const personalExpenseId = data.personalExpenseId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const pageA = await ctxA.newPage();

    await pageA.goto(`/expense/${personalExpenseId}`);
    await expect(pageA.getByText(/Gasto personal — privado/)).toBeVisible({ timeout: 10000 });

    await pageA.locator('[data-testid="expense-promote"]').click();
    const sharePromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${personalExpenseId}/share`) && res.request().method() === 'POST'
    );
    await pageA.locator('[data-testid="expense-promote-confirm"]').click();
    const shareResponse = await sharePromise;
    expect(shareResponse.ok()).toBeTruthy();

    // The detail page re-renders as a shared expense with its split breakdown
    await expect(pageA.getByText('Reparto del gasto')).toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText(/Gasto personal — privado/)).not.toBeVisible();

    // It now shows up in the shared movements list
    await pageA.goto('/expenses/list');
    await expect(pageA.getByText('Personal Expense')).toBeVisible({ timeout: 10000 });

    // userA: +50€ from the seeded shared expense (100€ 50/50) + 250€ from the
    // promoted one (500€ 50/50 paid by userA) = +300€
    await pageA.goto('/dashboard');
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/\+300,00\s*€/, { timeout: 10000 });

    await pageA.close();
    await ctxA.close();

    // userB owes the mirror image
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageB = await ctxB.newPage();
    await pageB.goto('/dashboard');
    await expect(pageB.locator('[data-testid="balance-amount"]')).toHaveText(/-300,00\s*€/, { timeout: 10000 });

    await pageB.close();
    await ctxB.close();
  });
});
