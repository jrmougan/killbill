import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

async function openBudget(page: Page, request: APIRequestContext): Promise<void> {
  const seed = await seedScenario(request, 'couple-no-expenses');
  if (!seed.userA?.password) throw new Error('Scenario must return registered user credentials');
  await loginAs(page, { email: seed.userA.email, password: seed.userA.password });
  await page.goto('/budget');
}

async function expectPersisted(api: APIRequestContext, cents: number): Promise<void> {
  const response = await api.get('/api/budget?scope=shared');
  expect(response.ok()).toBe(true);
  const { budgets } = await response.json();
  expect(budgets).toHaveLength(1);
  expect(budgets[0].budget).toMatchObject({ category: 'food', amount: cents });
}

async function failSaveThenRetry(page: Page, value: string, previousLimit?: RegExp): Promise<void> {
  const failures: Array<{ status?: number; error?: string; expected: RegExp }> = [
    { status: 400, error: 'Invalid category', expected: /No se pudo guardar.*Invalid category.*Vuelve a intentarlo/ },
    // A non-JSON server error should still produce an actionable fallback.
    { status: 500, expected: /No se pudo guardar.*Vuelve a intentarlo/ },
    { expected: /Comprueba tu conexión y vuelve a intentarlo/ },
  ];
  let posts = 0;
  let reads = 0;
  await page.route('**/api/budget', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    const failure = failures[posts - 1];
    if (failure.status === undefined) return route.abort('failed');
    if (!failure.error) return route.fulfill({ status: failure.status, contentType: 'text/html', body: 'Service unavailable' });
    await route.fulfill({ status: failure.status, json: { error: failure.error } });
  });
  await page.route('**/api/budget?scope=*', async route => {
    reads += 1;
    await route.continue();
  });
  const input = page.getByRole('spinbutton', { name: 'Importe del presupuesto' });
  await input.fill(value);
  for (const failure of failures) {
    await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(failure.expected);
    await expect(input).toHaveValue(value);
    if (previousLimit) await expect(page.getByText(previousLimit)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar presupuesto', exact: true })).toBeEnabled();
  }
  expect(posts).toBe(3);
  expect(reads).toBe(0);
  await page.unroute('**/api/budget');
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/budget' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ amount: Number(value), category: 'food', scope: 'shared' });
  expect((await response.json()).budget.amount).toBe(Math.round(Number(value) * 100));
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
}

test.describe('Budget failures and retries', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('add keeps the amount after 400, 500 and network failures; retry persists exact cents', async ({ page, request, context }) => {
    await openBudget(page, request);
    await page.getByRole('button', { name: 'Añadir presupuesto de Comida', exact: true }).click();
    let invalidPosts = 0;
    const countInvalid = (route: Route) => { invalidPosts += 1; return route.continue(); };
    await page.route('**/api/budget', countInvalid);
    for (const amount of ['0', '-1', '0.001', '1e309']) {
      await page.getByRole('spinbutton', { name: 'Importe del presupuesto' }).fill(amount);
      await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(/Introduce un importe válido/);
      await expect(page.getByRole('spinbutton', { name: 'Importe del presupuesto' })).toBeVisible();
    }
    expect(invalidPosts).toBe(0);
    await page.unroute('**/api/budget', countInvalid);
    await failSaveThenRetry(page, '100.08');
    await expect(page.getByText(/Límite:\s*100,08\s*€/)).toBeVisible();
    await expectPersisted(context.request, 10008);
    await page.reload();
    await expect(page.getByText(/Límite:\s*100,08\s*€/)).toBeVisible();
  });

  test('edit retains the previous limit and entered amount through rejected saves and retries', async ({ page, request, context }) => {
    await openBudget(page, request);
    const initial = await context.request.post('/api/budget', { data: { category: 'food', amount: 100.08, scope: 'shared' } });
    expect(initial.status()).toBe(201);
    await page.reload();
    await page.getByRole('button', { name: 'Editar presupuesto de Comida', exact: true }).click();
    await failSaveThenRetry(page, '125.10', /Límite:\s*100,08\s*€/);
    await expect(page.getByText(/Límite:\s*125,10\s*€/)).toBeVisible();
    await expectPersisted(context.request, 12510);

    // A successful write followed by a failed refresh must not erase the form or old data.
    await page.getByRole('button', { name: 'Editar presupuesto de Comida', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Importe del presupuesto' }).fill('130.12');
    await page.route('**/api/budget?scope=shared', route => route.fulfill({ status: 500, json: { error: 'Read unavailable' } }));
    await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(/No se pudieron cargar.*Read unavailable.*Vuelve a intentarlo/);
    await expect(page.getByRole('spinbutton', { name: 'Importe del presupuesto' })).toHaveValue('130.12');
    await expect(page.getByText(/Límite:\s*125,10\s*€/)).toBeVisible();
    await expectPersisted(context.request, 13012);
    await page.unroute('**/api/budget?scope=shared');
    await page.getByRole('button', { name: 'Guardar presupuesto', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Importe del presupuesto' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/Límite:\s*130,12\s*€/)).toBeVisible();
    await expectPersisted(context.request, 13012);
  });

  test('failed reads show a retry instead of an empty successful budget list', async ({ page, request, context }) => {
    await openBudget(page, request);
    const initial = await context.request.post('/api/budget', { data: { category: 'food', amount: 100.08, scope: 'shared' } });
    expect(initial.status()).toBe(201);
    await page.reload();
    await page.route('**/api/budget?scope=personal', route => route.fulfill({ status: 500, json: { error: 'Read unavailable' } }));
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(/No se pudieron cargar.*Read unavailable.*Vuelve a intentarlo/);
    await expect(page.getByRole('heading', { name: 'Sin presupuestos aún' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Añadir presupuesto de Comida', exact: true })).toHaveCount(0);
    await page.unroute('**/api/budget?scope=personal');
    await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sin presupuestos aún' })).toBeVisible();
    await page.getByRole('button', { name: 'Común', exact: true }).click();
    await expect(page.getByText(/Límite:\s*100,08\s*€/)).toBeVisible();
    await expectPersisted(context.request, 10008);
  });
});
