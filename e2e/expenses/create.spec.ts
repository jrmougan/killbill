import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
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
    userA = data.userA!;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  // The add-expense flow is a single numpad screen (EQUIL): amount via the
  // on-screen keypad (or typing), optional concept, category chips, Pagó/Reparto
  // tiles and "Guardar". Advanced options live under "Más opciones".

  test('create expense with the numpad - appears in expense list', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    for (const key of ['2', '5', 'Coma decimal', '5']) {
      await page.getByRole('button', { name: key, exact: true }).click();
    }
    await expect(page.getByTestId('expense-amount')).toHaveValue('25,5');
    // Couple space, paid by me, split in half → the partner owes me half.
    await expect(page.getByTestId('expense-preview')).toContainText('te deberá 12,75');
    await page.getByTestId('expense-description').fill('Test E2E Expense');
    await page.getByTestId('expense-submit').click();

    await expect(page).toHaveURL(/\/dashboard\?saved=2550/, { timeout: 10000 });

    await page.goto('/expenses/list');
    await expect(page.getByText('Test E2E Expense')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pagaste tú · a medias').first()).toBeVisible();
  });

  test('amount 0 - Guardar is disabled', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    await page.getByTestId('expense-amount').fill('0');
    await expect(page.getByTestId('expense-submit')).toBeDisabled();
    await page.getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(page.getByTestId('expense-submit')).toBeDisabled();
  });

  test('empty concept - saves with the category label as title', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new');
    await page.getByTestId('expense-amount').fill('15.00');
    await page.getByTestId('category-chip-transport').click();
    // "Solo para mí" → nothing owed either way.
    await page.getByTestId('expense-split').click();
    await expect(page.getByTestId('expense-split')).toContainText('Solo para mí');
    await expect(page.getByTestId('expense-preview')).toHaveText('No cambia el saldo');
    const created = page.waitForResponse(r => r.url().endsWith('/api/expenses') && r.request().method() === 'POST');
    await page.getByTestId('expense-submit').click();
    const res = await created;
    expect(res.status()).toBe(200);
    const body = JSON.parse(res.request().postData() || '{}');
    expect(body).toMatchObject({ description: 'Transporte', category: 'transport', amount: 15, beneficiaryId: userA.id });
  });

  test('prefill contract: title, category, personal space and returnTo', async ({ page }) => {
    await loginAs(page, userA);

    await page.goto('/expenses/new?title=Mercadona&category=food&space=personal&returnTo=/expenses/list');
    await expect(page.getByTestId('expense-description')).toHaveValue('Mercadona');
    await expect(page.getByTestId('space-chip-personal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('category-chip-food')).toHaveAttribute('aria-pressed', 'true');
    // Personal space: no payer / split tiles.
    await expect(page.getByTestId('expense-split')).toHaveCount(0);
    await page.getByTestId('expense-amount').fill('7');
    const created = page.waitForResponse(r => r.url().endsWith('/api/expenses') && r.request().method() === 'POST');
    await page.getByTestId('expense-submit').click();
    const body = JSON.parse((await created).request().postData() || '{}');
    expect(body).toMatchObject({ visibility: 'PERSONAL', description: 'Mercadona', category: 'food' });
    await expect(page).toHaveURL(/\/expenses\/list\?saved=700/, { timeout: 10000 });
  });
});
