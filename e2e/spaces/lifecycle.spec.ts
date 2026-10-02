import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

/**
 * Space lifecycle from the UI (src/lib/space-policy.ts ALLOWED_TRANSITIONS):
 *   ACTIVE -> SETTLING | ARCHIVED, SETTLING -> ACTIVE | ARCHIVED, ARCHIVED -> (terminal).
 * Transitions live in SpaceActions (/spaces/[id], OWNER/ADMIN only) and go through
 * PATCH /api/spaces/[id]. Every test resets + seeds its own scenario.
 *
 * Note: the dashboard "+" FAB is NOT hidden while SETTLING (spaceOperative ignores
 * status); the block is enforced server-side (POST /api/expenses → 409) and surfaced
 * as the form error, which is what these tests assert.
 */

type Creds = { email: string; password: string; id: string };

// Exact es-ES amounts (Intl inserts a NBSP before €, matched by \s).
const PLUS_50 = /^\+50,00\s€$/;
const PLUS_60 = /^\+60,00\s€$/;

function spacePatch(page: Page, spaceId: string) {
  return page.waitForResponse(
    (res) => res.url().endsWith(`/api/spaces/${spaceId}`) && res.request().method() === 'PATCH',
  );
}

function expensePost(page: Page) {
  return page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/expenses' && res.request().method() === 'POST',
  );
}

/** Fill the 2-step add-expense wizard and submit; returns the POST response. */
async function submitSharedExpense(page: Page, amount: string, description: string) {
  await page.goto('/expenses/new');
  await page.fill('[data-testid="expense-amount"]', amount);
  await page.click('[data-testid="expense-next"]');
  await page.fill('[data-testid="expense-description"]', description);
  const responsePromise = expensePost(page);
  await page.click('[data-testid="expense-submit"]');
  return responsePromise;
}

test.describe('Spaces - Lifecycle (UI)', () => {
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

  test('ACTIVE → SETTLING: OWNER starts closing; dashboard shows the banner and new expenses are rejected', async ({ page }) => {
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as Creds; // OWNER
    const spaceId = data.coupleId as string;
    const expenseId = data.expenseId as string;

    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);

    const header = page.getByTestId('space-header-status');
    await expect(header).toHaveText('Pareja · Activo');
    await expect(page.getByTestId('space-action-reopen')).toHaveCount(0);

    const patchPromise = spacePatch(page, spaceId);
    await page.getByTestId('space-action-settle').click();
    const patch = await patchPromise;
    expect(patch.status()).toBe(200);
    expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ status: 'SETTLING' });

    // The page reloads with the committed lifecycle status.
    await expect(header).toHaveText('Pareja · Liquidando');
    await expect(header).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-action-settle')).toHaveCount(0);
    await expect(page.getByTestId('space-action-reopen')).toBeVisible();
    await expect(page.getByTestId('space-action-archive')).toBeVisible();
    // The space page renders the banner too.
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');

    // Dashboard: SETTLING banner with the OWNER close CTA; the balance is untouched.
    await page.goto('/dashboard');
    const banner = page.getByTestId('space-status-banner');
    await expect(banner).toHaveAttribute('data-status', 'SETTLING');
    await expect(banner).toContainText('Cerrando cuentas');
    await expect(banner).toContainText('No se pueden crear gastos nuevos; solo liquidar.');
    await expect(page.getByTestId('space-status-close-link')).toHaveAttribute('href', `/spaces/${spaceId}/close`);
    await expect(page.getByTestId('balance-amount')).toHaveText(PLUS_50);

    // Adding a shared expense is blocked: the API answers 409 and the form shows why.
    const expenseRes = await submitSharedExpense(page, '20.00', 'Gasto bloqueado');
    expect(expenseRes.status()).toBe(409);
    expect((await expenseRes.json()).code).toBe('SPACE_NOT_WRITABLE');
    await expect(page.getByText('Este espacio se está liquidando: no se pueden crear gastos nuevos')).toBeVisible();
    await expect(page).toHaveURL(/\/expenses\/new/);

    // Existing expenses become read-only (no edit/delete).
    await page.goto(`/expense/${expenseId}`);
    await expect(page.getByText('Este espacio está liquidando — solo lectura.')).toBeVisible();
    await expect(page.locator(`a[href="/expense/${expenseId}/edit"]`)).toHaveCount(0);

    // Nothing was recorded: the balance is still exactly +50,00 €.
    await page.goto('/dashboard');
    await expect(page.getByTestId('balance-amount')).toHaveText(PLUS_50);
  });

  test('SETTLING → ACTIVE: OWNER reopens and can create expenses again', async ({ page }) => {
    // space-settling: SETTLING, B owes A 50 € with a PENDING (unposted) settlement.
    const data = await seedScenario(apiContext, 'space-settling');
    const userA = data.userA as Creds; // OWNER
    const spaceId = data.coupleId as string;

    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);

    const header = page.getByTestId('space-header-status');
    await expect(header).toHaveText('Pareja · Liquidando');

    const patchPromise = spacePatch(page, spaceId);
    await page.getByTestId('space-action-reopen').click();
    const patch = await patchPromise;
    expect(patch.status()).toBe(200);
    expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ status: 'ACTIVE' });

    await expect(header).toHaveText('Pareja · Activo');
    await expect(page.getByTestId('space-action-reopen')).toHaveCount(0);
    await expect(page.getByTestId('space-action-settle')).toBeVisible();
    await expect(page.getByTestId('space-status-banner')).toHaveCount(0);

    // Dashboard: no lifecycle banner; PENDING settlements never post, so A is +50,00 €.
    await page.goto('/dashboard');
    await expect(page.getByTestId('balance-amount')).toHaveText(PLUS_50);
    await expect(page.getByTestId('space-status-banner')).toHaveCount(0);

    // A new 20 € shared expense paid by A (equal split) is accepted again.
    const expenseRes = await submitSharedExpense(page, '20.00', 'Gasto tras reabrir');
    expect(expenseRes.ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // +50 € + 10 € (half of 20 €) = +60,00 €.
    await expect(page.getByTestId('balance-amount')).toHaveText(PLUS_60);
    await page.goto('/expenses/list');
    await expect(page.getByText('Gasto tras reabrir')).toBeVisible();
  });

  test('SETTLING → ARCHIVED: OWNER archives; banner shown and the UI is read-only', async ({ page }) => {
    const data = await seedScenario(apiContext, 'space-settling');
    const userA = data.userA as Creds; // OWNER
    const spaceId = data.coupleId as string;
    const expenseId = data.expenseId as string;

    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);

    const header = page.getByTestId('space-header-status');
    await expect(header).toHaveText('Pareja · Liquidando');

    // Archiving asks for confirmation through window.confirm.
    page.once('dialog', (dialog) => void dialog.accept());
    const patchPromise = spacePatch(page, spaceId);
    await page.getByTestId('space-action-archive').click();
    const patch = await patchPromise;
    expect(patch.status()).toBe(200);
    expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ status: 'ARCHIVED' });

    await expect(header).toHaveText('Pareja · Archivado');
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'ARCHIVED');
    // ARCHIVED is terminal: no lifecycle transitions are offered.
    await expect(page.getByTestId('space-action-settle')).toHaveCount(0);
    await expect(page.getByTestId('space-action-reopen')).toHaveCount(0);
    await expect(page.getByTestId('space-action-archive')).toHaveCount(0);

    // Dashboard banner (read-only memory).
    await page.goto('/dashboard');
    const banner = page.getByTestId('space-status-banner');
    await expect(banner).toHaveAttribute('data-status', 'ARCHIVED');
    await expect(banner).toContainText('Espacio archivado');
    await expect(banner).toContainText('Solo lectura — un recuerdo de lo compartido.');
    await expect(page.getByTestId('space-status-close-link')).toHaveCount(0);

    // Expense detail: no edit/delete.
    await page.goto(`/expense/${expenseId}`);
    await expect(page.getByText('Este espacio está archivado — solo lectura.')).toBeVisible();
    await expect(page.locator(`a[href="/expense/${expenseId}/edit"]`)).toHaveCount(0);

    // Close flow: neither "start settling" nor "archive" any more.
    await page.goto(`/spaces/${spaceId}/close`);
    await expect(page.getByRole('heading', { name: /Cerrar/ })).toBeVisible();
    await expect(page.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(page.getByTestId('close-archive')).toHaveCount(0);

    // New expenses are rejected with the archived message.
    const expenseRes = await submitSharedExpense(page, '20.00', 'Gasto en archivado');
    expect(expenseRes.status()).toBe(409);
    await expect(page.getByText('Este espacio está archivado (solo lectura)')).toBeVisible();

    // And the code treats ARCHIVED as terminal: reopening is refused (400 INVALID_TRANSITION).
    const reopen = await page.request.patch(`/api/spaces/${spaceId}`, { data: { status: 'ACTIVE' } });
    expect(reopen.status()).toBe(400);
    expect((await reopen.json()).code).toBe('INVALID_TRANSITION');
  });

  test('MEMBER does not see lifecycle actions (OWNER/ADMIN only) and the API refuses them', async ({ page }) => {
    const data = await seedScenario(apiContext, 'space-settling');
    const userB = data.userB as Creds; // MEMBER
    const spaceId = data.coupleId as string;

    await loginAs(page, userB);
    await page.goto(`/spaces/${spaceId}`);

    await expect(page.getByTestId('space-header-status')).toHaveText('Pareja · Liquidando');
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');
    // The whole "Gestión" section (SpaceActions) is gated on canManage.
    await expect(page.getByRole('heading', { name: 'Gestión' })).toHaveCount(0);
    await expect(page.getByTestId('space-actions')).toHaveCount(0);
    await expect(page.getByTestId('space-action-reopen')).toHaveCount(0);
    await expect(page.getByTestId('space-action-archive')).toHaveCount(0);
    // The banner's close CTA is OWNER/ADMIN only too.
    await expect(page.getByTestId('space-status-close-link')).toHaveCount(0);

    // Dashboard banner without the close CTA.
    await page.goto('/dashboard');
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-status-close-link')).toHaveCount(0);

    // Close flow is readable but without manage actions.
    await page.goto(`/spaces/${spaceId}/close`);
    await expect(page.getByRole('heading', { name: /Cerrar/ })).toBeVisible();
    await expect(page.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(page.getByTestId('close-archive')).toHaveCount(0);

    // Server-side role gate (same session cookie): 403, status unchanged.
    const archive = await page.request.patch(`/api/spaces/${spaceId}`, { data: { status: 'ARCHIVED' } });
    expect(archive.status()).toBe(403);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-header-status')).toHaveText('Pareja · Liquidando');
  });
});
