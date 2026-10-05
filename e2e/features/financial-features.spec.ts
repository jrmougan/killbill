import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario, type SeedUser } from '../fixtures/db.fixture';
import { createAuthenticatedContext, loginAs } from '../fixtures/auth.fixture';

function credentials(user: SeedUser | undefined) {
  if (!user?.id || !user.password) throw new Error('Scenario must return registered user credentials');
  return { id: user.id, email: user.email, password: user.password };
}

async function createExpense(page: Page, description: string, amount: string, category: string, personal = false): Promise<string> {
  await page.goto(personal ? '/expenses/new?type=personal' : '/expenses/new');
  await page.getByTestId('expense-amount').fill(amount);
  await page.getByTestId('expense-description').fill(description);
  await page.getByRole('button', { name: new RegExp(category) }).click();
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/expenses' && response.request().method() === 'POST');
  await page.getByTestId('expense-submit').click();
  const response = await saved;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard/);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(typeof body.expenseId).toBe('string');
  return body.expenseId;
}

async function expectBalances(api: APIRequestContext, groupId: string, expected: Record<string, number>): Promise<void> {
  const response = await api.get(`/api/spaces/${groupId}/balance`);
  expect(response.status()).toBe(200);
  const { balances } = await response.json();
  expect(balances).toEqual(expected);
  expect(Object.values(balances).reduce<number>((total, amount) => total + Number(amount), 0)).toBe(0);
}

test.describe('Financial feature UI journeys', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('budget creation and editing reflect shared spend in euros across scope switches', async ({ page, context, request }) => {
    const seed = await seedScenario(request, 'couple-no-expenses');
    const userA = credentials(seed.userA);
    const userB = credentials(seed.userB);
    const groupId = seed.coupleId as string;
    await loginAs(page, userA);
    await createExpense(page, 'Compra para presupuesto', '25.02', 'Comida');
    await expect(page.getByTestId('balance-amount')).toHaveText(/\+12,51\s*€/);

    // Legacy /budget forwards to the "Mes" tab (Presupuestos view).
    await page.goto('/budget');
    await expect(page).toHaveURL(/\/month\?view=budget/);
    await page.getByRole('button', { name: 'Añadir presupuesto de Comida', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Importe del presupuesto' }).fill('100.08');
    const created = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/budget' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
    expect((await created).status()).toBe(201);
    // Row shows "spent / limit €"; the hero shows what is left (100,08 − 25,02).
    await expect(page.getByText('25,02 / 100,08 €', { exact: true })).toBeVisible();
    await expect(page.getByTestId('budget-remaining')).toHaveText(/75,06\s*€/);

    await page.getByRole('button', { name: 'Editar presupuesto de Comida', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Importe del presupuesto' })).toHaveValue('100.08');
    await page.getByRole('spinbutton', { name: 'Importe del presupuesto' }).fill('125.10');
    const edited = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/budget' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
    expect((await edited).status()).toBe(201);
    await expect(page.getByText('25,02 / 125,10 €', { exact: true })).toBeVisible();
    await expect(page.getByTestId('budget-remaining')).toHaveText(/100,08\s*€/);

    // The header meta toggles the lens: personal budgets are a separate set.
    await page.getByRole('link', { name: 'Cambiar a Personal', exact: true }).click();
    await expect(page).toHaveURL(/scope=personal/);
    await expect(page.getByText(/Aún no tienes presupuestos aquí/)).toBeVisible();
    await expect(page.getByText(/\/ 125,10 €/)).toHaveCount(0);
    await page.getByRole('link', { name: /^Cambiar a / }).click();
    await expect(page).not.toHaveURL(/scope=personal/);
    await expect(page.getByText('25,02 / 125,10 €', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('25,02 / 125,10 €', { exact: true })).toBeVisible();

    // Análisis reflects the same month spend by category.
    await page.getByRole('tab', { name: 'Análisis' }).click();
    await expect(page).toHaveURL(/view=analysis/);
    await expect(page.getByTestId('month-total')).toHaveText(/25,02\s*€/);
    await expect(page.getByRole('tabpanel', { name: 'Análisis' }).getByText('100%', { exact: true })).toBeVisible();
    await expectBalances(context.request, groupId, { [userA.id]: 1251, [userB.id]: -1251 });
    const response = await context.request.get('/api/budget?scope=shared');
    expect(response.ok()).toBe(true);
    const { budgets } = await response.json();
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toMatchObject({ budget: { amount: 12510, category: 'food' }, spent: 2502, percentage: 20 });
  });

  test('custom categories are usable in expenses while personal categories and spending stay private', async ({ page, request, context, newContext }) => {
    const seed = await seedScenario(request, 'couple-no-expenses');
    const userA = credentials(seed.userA);
    const userB = credentials(seed.userB);
    const groupId = seed.coupleId as string;
    await loginAs(page, userA);
    await page.goto('/categories');
    await page.getByRole('button', { name: 'Nueva categoría', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Viajes QA');
    const sharedCreated = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/spaces/${groupId}/categories` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear categoría', exact: true }).click();
    const sharedCategoryResponse = await sharedCreated;
    expect(sharedCategoryResponse.status()).toBe(201);
    const { category: sharedCategory } = await sharedCategoryResponse.json();
    await expect(page.getByRole('button', { name: 'Editar Viajes QA', exact: true })).toBeVisible();

    const personalCategoriesLoaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/me/categories' && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    expect((await personalCategoriesLoaded).ok()).toBe(true);
    await expect(page.getByText('Viajes QA', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Nueva categoría', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Secreto QA');
    const personalCreated = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/me/categories' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear categoría', exact: true }).click();
    const personalCategoryResponse = await personalCreated;
    expect(personalCategoryResponse.status()).toBe(201);
    const { category: personalCategory } = await personalCategoryResponse.json();
    await expect(page.getByRole('button', { name: 'Editar Secreto QA', exact: true })).toBeVisible();

    const sharedExpenseId = await createExpense(page, 'Escapada compartida QA', '37.02', 'Viajes QA');
    await expect(page.getByTestId('balance-amount')).toHaveText(/\+18,51\s*€/);
    const personalExpenseId = await createExpense(page, 'Diario privado QA', '12.35', 'Secreto QA', true);
    await expect(page.getByText('Diario privado QA', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal este mes', { exact: true }).locator('..')).toContainText(/12,35\s*€/);
    await expectBalances(context.request, groupId, { [userA.id]: 1851, [userB.id]: -1851 });
    const sharedResponse = await context.request.get('/api/expenses?scope=shared');
    expect(sharedResponse.ok()).toBe(true);
    const sharedExpenses = (await sharedResponse.json()).expenses;
    expect(sharedExpenses).toHaveLength(1);
    expect(sharedExpenses[0]).toMatchObject({ id: sharedExpenseId, amount: 3702, categoryId: sharedCategory.id, visibility: 'SHARED' });
    const personalResponse = await context.request.get('/api/expenses?scope=personal');
    expect(personalResponse.ok()).toBe(true);
    const personalExpenses = (await personalResponse.json()).expenses;
    expect(personalExpenses).toHaveLength(1);
    expect(personalExpenses[0]).toMatchObject({ id: personalExpenseId, amount: 1235, categoryId: personalCategory.id, visibility: 'PERSONAL', ownerId: userA.id });

    const memberContext = await createAuthenticatedContext(newContext, userB);
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/dashboard?scope=comun');
    await expect(memberPage.getByText('Escapada compartida QA', { exact: true })).toBeVisible();
    await expect(memberPage.getByTestId('balance-amount')).toHaveText(/-18,51\s*€/);
    await expect(memberPage.getByText('Diario privado QA', { exact: true })).toHaveCount(0);
    await memberPage.goto('/categories');
    await expect(memberPage.getByText('Viajes QA', { exact: true })).toBeVisible();
    await expect(memberPage.getByText('Secreto QA', { exact: true })).toHaveCount(0);
    const memberPersonalLoaded = memberPage.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/me/categories' && response.request().method() === 'GET');
    await memberPage.getByRole('button', { name: 'Personal', exact: true }).click();
    expect((await memberPersonalLoaded).ok()).toBe(true);
    await expect(memberPage.getByText('Secreto QA', { exact: true })).toHaveCount(0);
    await memberPage.goto('/dashboard?scope=personal');
    await expect(memberPage.getByText('Diario privado QA', { exact: true })).toHaveCount(0);
    await expect(memberPage.getByText('Personal este mes', { exact: true }).locator('..')).toContainText(/0,00\s*€/);

    const outsiderSeed = await seedScenario(request, 'solo-user');
    const outsiderContext = await createAuthenticatedContext(newContext, credentials(outsiderSeed.user));
    const outsiderPage = await outsiderContext.newPage();
    await outsiderPage.goto('/categories');
    await expect(outsiderPage.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
    await expect(outsiderPage.getByText('Viajes QA', { exact: true })).toHaveCount(0);
    await expect(outsiderPage.getByText('Secreto QA', { exact: true })).toHaveCount(0);
  });

  test('bank CSV preview exclusions and repeated UI import preserve personal totals and group balances', async ({ page, context, request, newContext }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    const userA = credentials(seed.userA);
    const userB = credentials(seed.userB);
    const groupId = seed.coupleId as string;
    await loginAs(page, userA);
    await expectBalances(context.request, groupId, { [userA.id]: 5000, [userB.id]: -5000 });
    const date = await page.evaluate(() => {
      const now = new Date();
      return `01/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    });
    const csv = Buffer.from(`fecha;importe;concepto\n${date};-18,50;Pan banco QA\n${date};-18,85;Fruta banco QA\n${date};-99,99;Compra excluida QA\n${date};2500,00;Nómina QA\n`);
    for (const expected of [{ created: 2, skipped: 0 }, { created: 0, skipped: 2 }]) {
      await page.goto('/expenses/import');
      await page.locator('input[type="file"]').setInputFiles({ name: 'extracto-qa.csv', mimeType: 'text/csv', buffer: csv });
      await expect(page.getByRole('heading', { name: '3 de 3 a importar' })).toBeVisible();
      await page.getByRole('checkbox', { name: /Compra excluida QA/ }).uncheck();
      await expect(page.getByRole('heading', { name: '2 de 3 a importar' })).toBeVisible();
      await page.getByRole('button', { name: /Comida/ }).click();
      const imported = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/expenses/import' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Importar 2 gastos', exact: true }).click();
      const response = await imported;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual(expected);
      await expect(page.getByRole('heading', { name: 'Importación completada' })).toBeVisible();
      await page.getByRole('link', { name: 'Ver mis gastos' }).click();
      await expect(page).toHaveURL(/\/expenses\/list\?scope=personal/);
      await expect(page.getByText('Pan banco QA', { exact: true })).toBeVisible();
      await expect(page.getByText('Fruta banco QA', { exact: true })).toBeVisible();
      await page.goto('/dashboard?scope=personal');
      await expect(page.getByText('Personal este mes', { exact: true }).locator('..')).toContainText(/37,35\s*€/);
      await expect(page.getByText('Compra excluida QA', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Nómina QA', { exact: true })).toHaveCount(0);
    }
    const personalResponse = await context.request.get('/api/expenses?scope=personal');
    expect(personalResponse.ok()).toBe(true);
    const { expenses } = await personalResponse.json();
    expect(expenses).toHaveLength(2);
    expect(expenses.map((expense: { amount: number }) => expense.amount).sort((a: number, b: number) => a - b)).toEqual([1850, 1885]);
    for (const expense of expenses) expect(expense).toMatchObject({ visibility: 'PERSONAL', ownerId: userA.id, coupleId: null });
    await expectBalances(context.request, groupId, { [userA.id]: 5000, [userB.id]: -5000 });
    await page.goto('/dashboard?scope=comun');
    await expect(page.getByTestId('balance-amount')).toHaveText(/\+50,00\s*€/);
    await expect(page.getByText('Pan banco QA', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Fruta banco QA', { exact: true })).toHaveCount(0);

    const memberContext = await createAuthenticatedContext(newContext, userB);
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/dashboard?scope=personal');
    await expect(memberPage.getByText('Personal este mes', { exact: true }).locator('..')).toContainText(/0,00\s*€/);
    await expect(memberPage.getByText('Pan banco QA', { exact: true })).toHaveCount(0);
    await expect(memberPage.getByText('Fruta banco QA', { exact: true })).toHaveCount(0);
    await memberPage.goto('/dashboard?scope=comun');
    await expect(memberPage.getByTestId('balance-amount')).toHaveText(/-50,00\s*€/);
  });
});
