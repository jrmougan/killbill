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

    // The edit screen is the same numpad form as "Añadir gasto" (G-11).
    await expect(pageA.getByRole('heading', { level: 1, name: 'Editar gasto' })).toBeVisible({ timeout: 10000 });
    const amountInput = pageA.getByTestId('expense-amount');
    await expect(amountInput).toHaveValue('100');
    await expect(pageA.getByTestId('expense-split')).toContainText('A medias');
    await amountInput.fill('200');

    const patchPromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'PATCH'
    );
    await pageA.getByRole('button', { name: 'Guardar cambios' }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBeTruthy();
    expect(JSON.parse(patchResponse.request().postData() || '{}')).toMatchObject({ amount: 200, splitEqual: true });

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

    // The confirmation is an accessible modal: focus on Cancelar, Escape closes it (G-23).
    await pageA.locator('[data-testid="expense-delete"]').click();
    const dialog = pageA.getByRole('alertdialog', { name: /^¿Eliminar/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Test Expense');
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await pageA.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await pageA.locator('[data-testid="expense-delete"]').click();
    const deletePromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'DELETE'
    );
    await dialog.getByRole('button', { name: 'Eliminar gasto' }).click();
    const deleteResponse = await deletePromise;
    expect(deleteResponse.ok()).toBeTruthy();

    // Back to the list it came from (shared scope), without the expense (G-24)
    await expect(pageA).toHaveURL(/\/expenses\/list$/, { timeout: 10000 });
    await expect(pageA.getByText('Test Expense', { exact: true })).not.toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText('Todavía no hay gastos.')).toBeVisible();
    await expect(pageA.getByText('Gasto «Test Expense» eliminado · saldo actualizado')).toBeVisible();

    // The balance is back to zero
    await pageA.goto('/dashboard');
    await expect(pageA.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/, { timeout: 10000 });

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

    // Switch the payer from userA ("Tú") to userB
    const payer = pageA.getByTestId('expense-payer');
    await expect(payer).toHaveValue(userA.id, { timeout: 10000 });
    await payer.selectOption(userB.id);
    await expect(pageA.getByTestId('expense-preview')).toContainText('Deberás 50,00');

    const patchPromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'PATCH'
    );
    await pageA.getByRole('button', { name: 'Guardar cambios' }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.ok()).toBeTruthy();

    // Detail page now attributes the payment to userB
    await expect(pageA).toHaveURL(new RegExp(`/expense/${expenseId}$`), { timeout: 10000 });
    await expect(pageA.getByText('Pagó User B', { exact: true })).toBeVisible({ timeout: 10000 });
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
    // One-way: the sheet says it can't go back to private.
    const promoteSheet = pageA.getByTestId('expense-promote-sheet');
    await expect(promoteSheet).toContainText('No podrás volver a hacerlo privado; solo eliminarlo.');
    await expect(promoteSheet).toContainText('No se puede deshacer.');
    const sharePromise = pageA.waitForResponse(
      (res) => res.url().includes(`/api/expenses/${personalExpenseId}/share`) && res.request().method() === 'POST'
    );
    await pageA.locator('[data-testid="expense-promote-confirm"]').click();
    const shareResponse = await sharePromise;
    expect(shareResponse.ok()).toBeTruthy();
    // It shares into the space the sheet showed, not whatever is active when it posts.
    expect(shareResponse.request().postDataJSON()).toEqual({ targetGroupId: expect.any(String) });

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
