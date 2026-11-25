import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

type Creds = { email: string; password: string; id: string };

/**
 * Regression coverage for the QA round on Gastos (G-01…G-24, T-01/03/05/06/07).
 */
test.describe('Gastos — QA fixes', () => {
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

  test('returnTo with tab/newline never leaves the app (G-01/T-01)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    await loginAs(page, data.userA as Creds);
    const origin = new URL(page.url()).origin;

    for (const vector of ['%2F%09%2Fexample.com', '%2F%0A%2Fexample.com', '%2F%5Cexample.com', '%2F%2Fexample.com']) {
      await page.goto(`/expenses/new?returnTo=${vector}`);
      await page.getByTestId('expense-close').click();
      await expect(page).toHaveURL(/\/dashboard/);
      expect(new URL(page.url()).origin).toBe(origin);
    }

    // Saving with a hostile returnTo also lands in-app.
    await page.goto('/expenses/new?returnTo=%2F%09%2Fexample.com');
    await page.getByTestId('expense-amount').fill('3');
    await page.getByTestId('expense-submit').click();
    await expect(page).toHaveURL(/\/dashboard\?saved=300/);
    expect(new URL(page.url()).origin).toBe(origin);
  });

  test('the expense goes to the space chosen in the form, not the active one (G-02)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    const coupleId = data.coupleId as string;
    await loginAs(page, data.userA as Creds);

    // A second space; creating it makes it the active one.
    const created = await page.request.post('/api/spaces', { data: { name: 'Piso E2E', type: 'GROUP' } });
    expect(created.ok()).toBeTruthy();
    const pisoId = (await created.json()).space.id as string;

    // Form opened on the couple…
    await page.goto(`/expenses/new?space=${coupleId}`);
    await expect(page.getByTestId(`space-chip-${coupleId}`)).toHaveAttribute('aria-pressed', 'true');
    // …meanwhile another tab makes the Piso active.
    const other = await page.context().newPage();
    await other.goto(`/expenses/new?space=${pisoId}`);
    await other.getByTestId('expense-amount').fill('5');
    await other.getByTestId('expense-submit').click();
    await expect(other).toHaveURL(/\/dashboard/);
    await other.close();

    await page.getByTestId('expense-amount').fill('8');
    await page.getByTestId('expense-description').fill('Para la pareja');
    const post = page.waitForResponse((r) => r.url().endsWith('/api/expenses') && r.request().method() === 'POST');
    await page.getByTestId('expense-submit').click();
    const res = await post;
    expect(res.status()).toBe(200);
    expect(JSON.parse(res.request().postData() || '{}').groupId).toBe(coupleId);
    expect((await res.json()).groupId).toBe(coupleId);
    await expect(page).toHaveURL(/\/dashboard/);

    // The couple is the active space again and lists the expense.
    await page.goto('/expenses/list');
    await expect(page.getByText('Para la pareja')).toBeVisible();
  });

  test('POST /api/expenses authorizes the explicit groupId and validates dates (G-02/T-03)', async ({ page, newContext }) => {
    await resetDb(apiContext);
    const own = await seedScenario(apiContext, 'couple-no-expenses');
    const foreign = await seedScenario(apiContext, 'couple-with-debt');
    await loginAs(page, own.userA as Creds);

    const base = { amount: 4, description: 'x', category: 'food' };
    const intoForeign = await page.request.post('/api/expenses', { data: { ...base, groupId: foreign.coupleId } });
    expect(intoForeign.status()).toBe(403);

    for (const date of ['2026-02-31', '0001-01-01', '9999-12-31', '2099-01-01']) {
      const res = await page.request.post('/api/expenses', { data: { ...base, isPersonal: true, date } });
      expect(res.status(), date).toBe(400);
      expect((await res.json()).error).toMatch(/fecha/i);
    }
    const ok = await page.request.post('/api/expenses', { data: { ...base, groupId: own.coupleId, date: '2026-09-15' } });
    expect(ok.status()).toBe(200);

    // Concurrent saves in the same space never 500 (G-04).
    const ctxB = await newContext();
    const pageB = await ctxB.newPage();
    await loginAs(pageB, own.userB as Creds);
    const burst = await Promise.all([
      page.request.post('/api/expenses', { data: { ...base, description: 'c1' } }),
      pageB.request.post('/api/expenses', { data: { ...base, description: 'c2' } }),
      page.request.post('/api/expenses', { data: { ...base, description: 'c3' } }),
      pageB.request.post('/api/expenses', { data: { ...base, description: 'c4' } }),
    ]);
    expect(burst.map((r) => r.status())).toEqual([200, 200, 200, 200]);
    await ctxB.close();
  });

  test('editing a personal expense: new personal tag and a different date (G-07/G-11/T-07)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    const id = data.personalExpenseId as string;
    await loginAs(page, data.userA as Creds);

    await page.goto(`/expense/${id}/edit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Editar gasto' })).toBeVisible();
    await page.getByTestId('expense-more').click();
    const sheet = page.getByRole('dialog', { name: 'Más opciones' });
    await sheet.getByRole('button', { name: 'Nueva etiqueta' }).click();
    await sheet.getByLabel('Nombre de la etiqueta').fill('ptag-edit');
    const tagCreated = page.waitForResponse((r) => r.url().endsWith('/api/tags') && r.request().method() === 'POST');
    await sheet.getByRole('button', { name: 'Crear' }).click();
    expect(JSON.parse((await tagCreated).request().postData() || '{}').personal).toBe(true);
    await sheet.getByTestId('expense-date').fill('2026-09-15');
    await sheet.getByRole('button', { name: 'Listo' }).click();

    const tagged = page.waitForResponse((r) => r.url().endsWith(`/api/expenses/${id}/tags`));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    expect((await tagged).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/expense/${id}$`));
    await expect(page.getByText('ptag-edit')).toBeVisible();
    await expect(page.getByText(/15 de septiembre de 2026/)).toBeVisible();
  });

  test('"Más opciones" is a real modal and the form has a heading (T-06/G-21/G-22)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    await loginAs(page, data.userA as Creds);
    await page.goto('/expenses/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Nuevo gasto' })).toBeAttached();
    await page.getByTestId('expense-more').click();
    const sheet = page.getByRole('dialog', { name: 'Más opciones' });
    await expect(sheet).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      // Focus cycles inside the modal (or briefly to the browser chrome: body), never to the form behind.
      expect(await page.evaluate(() => {
        const el = document.activeElement;
        return !el || el === document.body || !!el.closest('dialog');
      })).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('pasting "1.234,56" keeps 1.234,56 € and junk shows an error (G-05)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    await loginAs(page, data.userA as Creds);
    await page.goto('/expenses/new');
    const amount = page.getByTestId('expense-amount');
    await amount.fill('1.234,56');
    await expect(amount).toHaveValue('1234,56');
    await amount.fill('1,2,3');
    await expect(amount).toHaveValue('1234,56');
    await expect(page.getByRole('alert').filter({ hasText: 'Importe no válido' })).toBeVisible();
  });

  test('Gastos has a Común/Personal selector synced with ?scope=personal (G-08/T-05)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    await loginAs(page, data.userA as Creds);
    await page.goto('/expenses/list');
    await expect(page.getByRole('tab', { name: 'Común' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Shared Expense')).toBeVisible();
    await page.getByRole('tab', { name: 'Personal' }).click();
    await expect(page).toHaveURL(/\/expenses\/list\?scope=personal/);
    await expect(page.getByText('Personal Expense')).toBeVisible();
    await expect(page.getByText('Shared Expense')).toHaveCount(0);
  });
});
