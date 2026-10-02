import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

type Creds = { email: string; password: string; id: string };

test.describe('Shopping Lists - UI Happy Path', () => {
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
  });

  test.beforeEach(async () => {
    await resetDb(apiContext);
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('prefilled group list: view, add item, toggle check, clear checked, and verify no expenses created', async ({ page }) => {
    const data = await seedScenario(apiContext, 'lists-prefilled');
    const userA = data.userA as Creds;
    const groupListId = data.groupListId as string;

    await loginAs(page, userA);

    // Initial dashboard balance is 0,00 €
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/);

    // Go to shopping lists index
    await page.goto('/lists');
    await expect(page.getByRole('heading', { name: 'Listas de la compra' })).toBeVisible({ timeout: 10000 });

    // Click on the group list "Mercadona"
    const mercadonaCard = page.locator(`a[href="/lists/${groupListId}"]`);
    await expect(mercadonaCard).toBeVisible();
    await expect(mercadonaCard).toContainText('Mercadona');
    await mercadonaCard.click();

    await expect(page).toHaveURL(`/lists/${groupListId}`);
    await expect(page.getByRole('heading', { name: 'Mercadona' })).toBeVisible();

    // Verify existing prefilled items
    await expect(page.getByText('Leche')).toBeVisible();
    await expect(page.getByText('Plátanos')).toBeVisible();

    // Add a new item via UI (e.g. "Manzanas")
    const addItemInput = page.getByPlaceholder('Añadir artículo…');
    await expect(addItemInput).toBeVisible();
    await addItemInput.fill('Manzanas');

    const postItemPromise = page.waitForResponse(
      (res) => res.url().includes(`/items`) && res.request().method() === 'POST'
    );
    await page.getByPlaceholder('Añadir artículo…').press('Enter');
    const postItemRes = await postItemPromise;
    expect(postItemRes.ok()).toBeTruthy();

    await expect(page.getByText('Manzanas')).toBeVisible({ timeout: 10000 });

    // Toggle check on "Leche" (was unchecked)
    const lecheRow = page.locator('div.bg-card', { hasText: 'Leche' });
    const toggleLeche = lecheRow.getByRole('button', { name: 'Marcar como comprado' });
    await expect(toggleLeche).toBeVisible();

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/items/') && res.request().method() === 'PATCH'
    );
    await toggleLeche.click();
    const patchRes = await patchPromise;
    expect(patchRes.ok()).toBeTruthy();

    // Now Leche should have the pending toggle label
    await expect(lecheRow.getByRole('button', { name: 'Marcar como pendiente' })).toBeVisible({ timeout: 10000 });

    // Clear checked items: click "Vaciar comprados"
    const clearButton = page.getByRole('button', { name: /Vaciar comprados/ });
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Modal confirmation appears
    const confirmButton = page.getByRole('button', { name: /^Vaciar \(\d+\)$/ });
    await expect(confirmButton).toBeVisible();

    const clearPromise = page.waitForResponse(
      (res) => res.url().includes('/clear-checked') && res.request().method() === 'POST'
    );
    await confirmButton.click();
    const clearRes = await clearPromise;
    expect(clearRes.ok()).toBeTruthy();

    // Checked items (like Leche, Plátanos, Pollo) are now gone
    await expect(page.getByText('Plátanos')).toHaveCount(0);
    await expect(page.getByText('Leche')).toHaveCount(0);
    // Unchecked items remain
    await expect(page.getByText('Manzanas')).toBeVisible();

    // INVARIANT CHECK: Shopping list actions NEVER create an expense or alter balance
    await page.goto('/dashboard');
    await expect(page.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/);
    await page.goto('/expenses/list');
    await expect(page.getByText('Sin resultados')).toBeVisible();
  });

  test('personal shopping list: switch scope tab and create new personal list via UI', async ({ page }) => {
    const data = await seedScenario(apiContext, 'lists-prefilled');
    const userA = data.userA as Creds;
    const personalListId = data.personalListId as string;

    await loginAs(page, userA);
    await page.goto('/lists');

    // Switch to "Personal" tab
    const personalTab = page.getByRole('button', { name: 'Personal' });
    await expect(personalTab).toBeVisible();
    await personalTab.click();
    await expect(personalTab).toHaveAttribute('aria-pressed', 'true');

    // Pre-seeded personal list "Farmacia" is displayed
    const farmaciaCard = page.locator(`a[href="/lists/${personalListId}"]`);
    await expect(farmaciaCard).toBeVisible();
    await expect(farmaciaCard).toContainText('Farmacia');

    // Create a new personal list
    const listNameInput = page.getByPlaceholder('p. ej. Farmacia');
    await expect(listNameInput).toBeVisible();
    await listNameInput.fill('Ferretería');

    const createPromise = page.waitForResponse(
      (res) => res.url().includes('/api/me/lists') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /Crear/ }).click();
    const createRes = await createPromise;
    expect(createRes.ok()).toBeTruthy();

    // The new list is now in the list
    await expect(page.getByText('Ferretería')).toBeVisible({ timeout: 10000 });
  });
});
