import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Dashboard - Balance', () => {
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

  test('userA has positive balance with couple-with-debt scenario', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA;

    await loginAs(page, userA!);
    await expect(page).toHaveURL(/\/dashboard/);

    const balance = page.locator('[data-testid="balance-amount"]');
    await expect(balance).toBeVisible({ timeout: 10000 });

    const balanceText = await balance.textContent();
    // userA paid 100€ and split 50/50, so they are owed 50€ → positive balance
    expect(balanceText).toContain('+');
  });

  test('userB has negative balance with couple-with-debt scenario', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userB = data.userB;

    await loginAs(page, userB!);
    await expect(page).toHaveURL(/\/dashboard/);

    const balance = page.locator('[data-testid="balance-amount"]');
    await expect(balance).toBeVisible({ timeout: 10000 });

    const balanceText = await balance.textContent();
    // userB owes 50€, so negative balance - no "+" sign
    expect(balanceText).not.toContain('+');
    // Should be negative (either no prefix or with an amount that implies debt)
    const amount = parseFloat(balanceText?.replace('€', '').trim() || '0');
    expect(amount).toBeLessThan(0);
  });

  test('pending settlement is visible on dashboard for receiver (userA)', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-pending-settlement');
    const userA = data.userA;

    await loginAs(page, userA!);
    await expect(page).toHaveURL(/\/dashboard/);

    // UserA is the receiver of the pending settlement - should see "Confirmar Pagos"
    const confirmSection = page.getByText(/Confirmar Pagos/i);
    await expect(confirmSection).toBeVisible({ timeout: 10000 });
  });

  test('active card words the balance and switching spaces keeps the server as authority', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    await loginAs(page, data.userA!);
    await expect(page).toHaveURL(/\/dashboard/);

    // Active couple card: "User te debe 50,00 €" + the settle shortcut.
    const active = page.getByTestId('space-card-active');
    await expect(active).toContainText('Debt Couple');
    await expect(active).toContainText('User te debe');
    await expect(active).toContainText(/50,00\s€/);
    await expect(active.getByRole('link', { name: 'Quedar en paz' })).toHaveAttribute('href', '/settle');
    await expect(page.getByTestId('month-summary')).toContainText('en Debt Couple');

    // Carousel → personal context.
    // The inactive card announces its balance (no emoji) to assistive tech.
    await expect(page.getByRole('button', { name: /^Cambiar a Personal\. Solo tú\. Personal este mes: 0,00\s€$/ })).toBeVisible();
    await page.getByRole('button', { name: /Cambiar a Personal/ }).click();
    await expect(page).toHaveURL(/\/dashboard\?scope=personal/);
    await expect(page.getByTestId('space-card-active')).toContainText('Personal este mes');
    await expect(page.getByTestId('balance-amount')).toHaveCount(0);
    // "Ver todo" keeps the personal scope.
    await expect(page.getByRole('link', { name: 'Ver todo' })).toHaveAttribute('href', '/expenses/list?scope=personal');

    // Espacios marks Personal active; its back arrow returns to the personal context.
    await page.getByRole('link', { name: 'Ver espacios' }).click();
    await expect(page).toHaveURL(/\/spaces\?active=personal/);
    await expect(page.getByRole('link', { name: 'Volver a Inicio' })).toHaveAttribute('href', '/dashboard?scope=personal');
    const rows = page.getByTestId('space-row');
    await expect(rows.filter({ hasText: 'Personal' })).toHaveAttribute('data-active', 'true');
    const coupleRow = rows.filter({ hasText: 'Debt Couple' });
    await expect(coupleRow).toContainText('tú y User');
    await expect(coupleRow).toContainText(/\+50,00\s€/);
    await expect(coupleRow.getByRole('link', { name: 'Gestionar Debt Couple' })).toHaveAttribute('href', /\/spaces\/.+/);
    // A full couple offers no invite link.
    await expect(page.getByTestId('space-invite-card')).toHaveCount(0);

    await coupleRow.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('balance-amount')).toHaveText(/^\+50,00\s€$/);
  });

  test('pasting an invite link routes to the consent screen', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    await loginAs(page, data.userA!);
    await page.goto('/spaces?join=1');
    await page.getByLabel('Pega el enlace de invitación').fill('https://example.test/i/abc123TOKEN');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\/i\/abc123TOKEN$/);
  });

  test('?saved=<cents> shows a one-shot "Gasto guardado" toast and is stripped', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-debt');
    await loginAs(page, data.userA!);
    await page.goto('/dashboard?scope=personal&saved=4385');
    await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toHaveText(/Gasto guardado · 43,85\s€/);
    await expect(page).toHaveURL(/\/dashboard\?scope=personal$/);
  });
});
