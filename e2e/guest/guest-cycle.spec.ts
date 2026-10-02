import { test, expect, request as playwrightRequest, Browser, BrowserContext } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';

/** A browser session authenticated as the seeded guest (JWT kind:'guest' in the session cookie). */
async function createGuestContext(browser: Browser, sessionToken: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'session_token', value: sessionToken, url: baseURL }]);
  return context;
}

test.describe('Guest - Full lifecycle in an ephemeral space', () => {
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({ baseURL });
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('guest session loads the dashboard with banner and reduced bottom nav', async ({ browser }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'ephemeral-with-guest');
    const guest = data.guest as { id: string; sessionToken: string };

    const ctx = await createGuestContext(browser, guest.sessionToken);
    const page = await ctx.newPage();

    await page.goto('/dashboard');

    // Guest banner with the upgrade CTA
    const banner = page.locator('[data-testid="guest-banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('Estás como invitado');
    await expect(banner.getByRole('link', { name: /Crear cuenta/ })).toHaveAttribute('href', '/guest/upgrade');

    // Reduced bottom nav: only "Inicio" + "Crear cuenta"; none of the member-only tabs
    const nav = page.locator('nav[aria-label="Navegación principal"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Inicio' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Crear cuenta' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Presupuestos|Análisis|Ajustes/ })).toHaveCount(0);

    await page.close();
    await ctx.close();
  });

  test('the proxy cages the guest: /lists and /settings bounce to /dashboard', async ({ browser }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'ephemeral-with-guest');
    const guest = data.guest as { id: string; sessionToken: string };

    const ctx = await createGuestContext(browser, guest.sessionToken);
    const page = await ctx.newPage();

    await page.goto('/lists');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    await page.close();
    await ctx.close();
  });

  test('the guest can create an expense in its ephemeral space and sees it listed', async ({ browser }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'ephemeral-with-guest');
    const guest = data.guest as { id: string; sessionToken: string };

    const ctx = await createGuestContext(browser, guest.sessionToken);
    const page = await ctx.newPage();

    await page.goto('/expenses/new');

    // Wizard step 1: amount
    const amountInput = page.locator('[data-testid="expense-amount"]');
    await expect(amountInput).toBeVisible({ timeout: 10000 });
    await amountInput.fill('10');
    await page.locator('[data-testid="expense-next"]').click();

    // Wizard step 2: description + submit
    const descriptionInput = page.locator('[data-testid="expense-description"]');
    await expect(descriptionInput).toBeVisible({ timeout: 10000 });
    await descriptionInput.fill('Taxi al aeropuerto');

    const postPromise = page.waitForResponse(
      (res) => res.url().includes('/api/expenses') && res.request().method() === 'POST'
    );
    await page.locator('[data-testid="expense-submit"]').click();
    const postResponse = await postPromise;
    expect(postResponse.ok()).toBeTruthy();

    // Back on the dashboard. Balance: the seeded 60€ fuel expense (paid by the
    // owner, split 30/30) leaves the guest at -30€; its own 10€ expense split
    // 50/50 nets +5€ -> exactly -25,00 €.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('[data-testid="balance-amount"]')).toHaveText(/-25,00\s*€/, { timeout: 10000 });

    // The new expense appears in the shared movements list
    await page.goto('/expenses/list');
    const card = page.getByText('Taxi al aeropuerto');
    await expect(card).toBeVisible({ timeout: 10000 });

    await page.close();
    await ctx.close();
  });

  test('upgrading converts the guest into a full account with full nav and /settings access', async ({ browser }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'ephemeral-with-guest');
    const guest = data.guest as { id: string; sessionToken: string };

    const ctx = await createGuestContext(browser, guest.sessionToken);
    const page = await ctx.newPage();

    await page.goto('/guest/upgrade');

    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await emailInput.fill(`upgraded_${Date.now()}@test.com`);
    await page.locator('input[type="password"]').fill('Password123');

    const upgradePromise = page.waitForResponse(
      (res) => res.url().includes('/api/guest/upgrade') && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /Crear mi cuenta/i }).click();
    const upgradeResponse = await upgradePromise;
    expect(upgradeResponse.ok()).toBeTruthy();

    // Redirected to the dashboard as a full member: no guest banner, full nav
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('[data-testid="guest-banner"]')).toHaveCount(0);

    const nav = page.locator('nav[aria-label="Navegación principal"]');
    await expect(nav.getByRole('link', { name: 'Presupuestos' })).toBeVisible({ timeout: 10000 });
    await expect(nav.getByRole('link', { name: 'Análisis' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();

    // /settings is now reachable (no proxy bounce)
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible({ timeout: 10000 });

    await page.close();
    await ctx.close();
  });
});
