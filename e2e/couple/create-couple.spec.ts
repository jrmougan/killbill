import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Couple - Create', () => {
  let user: { email: string; password: string; id: string };
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'solo-user');
    user = data.user;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('user without a space sees the personal home with create/join actions', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    // A space-less user is fully usable in the personal context (no onboarding
    // wall): the personal card is active and sharing is an optional action.
    await expect(page.getByTestId('space-card-active')).toContainText('Personal este mes');
    await expect(page.getByRole('link', { name: 'Crear espacio' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Unirme con enlace' }).click();
    await expect(page.getByLabel('Pega el enlace de invitación')).toBeVisible();
  });

  test('creating a couple from "Crear espacio" makes it the active space', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('link', { name: 'Crear espacio' }).click();
    await expect(page).toHaveURL(/\/spaces\/new/);
    await expect(page.getByRole('heading', { name: '¿Con quién compartes gastos?' })).toBeVisible();

    await page.getByRole('button', { name: /Mi pareja/ }).click();
    await expect(page.getByRole('button', { name: /Mi pareja/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Nombre del espacio').fill('Casa QA');

    const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/spaces' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear espacio' }).click();
    expect((await created).status()).toBeLessThan(300);

    // Inicio now shows the new couple as the active (wide) card, still waiting
    // for the partner, with the secure-link invite card.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
    const activeCard = page.getByTestId('space-card-active');
    await expect(activeCard).toContainText('Casa QA');
    await expect(activeCard).toContainText('Solo tú');
    await expect(page.getByTestId('space-invite-card')).toContainText('Invitar a Casa QA');
    await expect(page.getByRole('link', { name: 'Crear espacio' })).toHaveCount(0);
  });
});
