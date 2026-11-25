import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext, loginAs } from '../fixtures/auth.fixture';

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

/**
 * POST a shared expense into the ACTIVE space straight to the API. The add
 * screen no longer offers SETTLING/ARCHIVED spaces at all, so the server-side
 * veto is asserted here directly.
 */
function postSharedExpense(page: Page, amount: string, description: string) {
  return page.request.post('/api/expenses', { data: { description, amount, category: 'other' } });
}

/** Fill the add-expense screen and submit; returns the POST response. */
async function submitSharedExpense(page: Page, amount: string, description: string) {
  await page.goto('/expenses/new');
  await page.fill('[data-testid="expense-amount"]', amount);
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
    // Archiving is not offered while ACTIVE (close accounts first).
    await expect(page.getByTestId('space-action-archive')).toHaveCount(0);

    // The button only opens the review sheet: nothing is written until it is confirmed.
    let patched = false;
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().endsWith(`/api/spaces/${spaceId}`)) patched = true;
    });
    await page.getByTestId('space-action-settle').click();
    const settleSheet = page.getByTestId('settle-sheet');
    await expect(settleSheet).toBeVisible();
    await expect(page.getByRole('dialog', { name: /¿Cerrar las cuentas de/ })).toBeVisible();
    expect(patched).toBe(false);
    const patchPromise = spacePatch(page, spaceId);
    await settleSheet.getByTestId('confirm-sheet-confirm').click();
    const patch = await patchPromise;
    expect(patch.status()).toBe(200);
    expect(JSON.parse(patch.request().postData() ?? '{}')).toEqual({ status: 'SETTLING' });

    // The page refreshes in place with the committed lifecycle status and points to /close.
    await expect(header).toHaveText('Pareja · Cerrando cuentas');
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}$`));
    await expect(page.getByText('Estáis cerrando cuentas. Ahora saldad las deudas.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver qué falta' })).toHaveAttribute('href', `/spaces/${spaceId}/close`);
    await expect(header).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-action-settle')).toHaveCount(0);
    await expect(page.getByTestId('space-action-reopen')).toBeVisible();
    await expect(page.getByTestId('space-action-archive')).toBeVisible();
    // No upgrade while closing; settling targets THIS space explicitly.
    await expect(page.getByTestId('space-action-convert')).toHaveCount(0);
    await expect(page.getByTestId('space-action-go-settle')).toHaveAttribute('href', `/settle?space=${spaceId}`);
    // The space page renders the banner too.
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-status-settle-link')).toHaveAttribute('href', `/settle?space=${spaceId}`);

    // Dashboard: SETTLING banner with the progress and ONE CTA — the owner is still owed,
    // so it is "Saldar deudas" (not the close flow); the balance is untouched.
    await page.goto('/dashboard');
    const banner = page.getByTestId('space-status-banner');
    await expect(banner).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-status-progress')).toHaveText('Cerrando cuentas · falta 1 deuda');
    await expect(banner).toContainText('No se pueden añadir ni editar gastos; sí saldar deudas.');
    await expect(banner.getByRole('link', { name: 'Saldar deudas →' })).toHaveAttribute('href', `/settle?space=${spaceId}`);
    await expect(page.getByTestId('space-status-close-link')).toHaveCount(0);
    await expect(page.getByTestId('balance-amount')).toHaveText(PLUS_50);

    // Adding a shared expense is blocked: the API answers 409 with the reason.
    const expenseRes = await postSharedExpense(page, '20.00', 'Gasto bloqueado');
    expect(expenseRes.status()).toBe(409);
    const blocked = await expenseRes.json();
    expect(blocked.code).toBe('SPACE_NOT_WRITABLE');
    expect(blocked.error).toBe('Estáis cerrando cuentas en este espacio: no se pueden crear gastos nuevos');

    // Existing expenses become read-only (no edit/delete).
    await page.goto(`/expense/${expenseId}`);
    await expect(page.getByText('Estáis cerrando cuentas: este gasto ya no se puede cambiar.')).toBeVisible();
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
    await expect(header).toHaveText('Pareja · Cerrando cuentas');

    await page.getByTestId('space-action-reopen').click();
    const reopenSheet = page.getByTestId('reopen-sheet');
    await expect(reopenSheet).toBeVisible();
    const patchPromise = spacePatch(page, spaceId);
    await reopenSheet.getByTestId('confirm-sheet-confirm').click();
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

  test('SETTLING → ARCHIVED: blocked while a payment is pending/debts are open, then archives; UI read-only', async ({ page, newContext }) => {
    // space-settling: B owes A 50 € and has a PENDING 50 € settlement.
    const data = await seedScenario(apiContext, 'space-settling');
    const userA = data.userA as Creds; // OWNER
    const userB = data.userB as Creds; // MEMBER, debtor
    const spaceId = data.coupleId as string;
    const expenseId = data.expenseId as string;
    const settlementId = data.settlementId as string;

    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);

    const header = page.getByTestId('space-header-status');
    await expect(header).toHaveText('Pareja · Cerrando cuentas');

    // The archive sheet always opens; with a PENDING payment it explains why and the CTA is disabled.
    await page.getByTestId('space-action-archive').click();
    const sheet = page.getByTestId('archive-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('alertdialog', { name: /¿Archivar/ })).toBeVisible();
    await expect(sheet.getByTestId('confirm-sheet-confirm')).toBeDisabled();
    await expect(sheet.getByTestId('confirm-sheet-reason')).toHaveText('Falta confirmar 1 pago');
    await expect(sheet.getByRole('link', { name: 'Ver qué falta' })).toHaveAttribute('href', `/spaces/${spaceId}/close`);
    await sheet.getByTestId('confirm-sheet-cancel').click();
    await expect(header).toHaveText('Pareja · Cerrando cuentas');

    // The creditor confirms the payment → everyone at peace.
    const confirmed = await page.request.patch(`/api/settle/${settlementId}/status`, { data: { status: 'CONFIRMED' } });
    expect(confirmed.ok(), await confirmed.text()).toBeTruthy();

    await page.reload();
    await page.getByTestId('space-action-archive').click();
    await expect(sheet.getByTestId('confirm-sheet-reason')).toHaveCount(0);
    const confirm = sheet.getByTestId('confirm-sheet-confirm');
    await expect(confirm).toBeEnabled();
    const sheetError = sheet.getByTestId('confirm-sheet-error');
    const settleLink = sheetError.getByRole('link', { name: /Saldar deudas/ });

    // Stale page: with the sheet open, the space gets a new debt behind its back
    // (reopen → A pays a 20 € shared expense → SETTLING again: B owes A 10 €).
    // The server refuses with 409 OPEN_BALANCES and the sheet shows it with the settle link.
    expect((await page.request.patch(`/api/spaces/${spaceId}`, { data: { status: 'ACTIVE' } })).ok()).toBeTruthy();
    const debt = await postSharedExpense(page, '20.00', 'Gasto con la hoja abierta');
    expect(debt.ok(), await debt.text()).toBeTruthy();
    expect((await page.request.patch(`/api/spaces/${spaceId}`, { data: { status: 'SETTLING' } })).ok()).toBeTruthy();

    const openBalances = spacePatch(page, spaceId);
    await confirm.click();
    const openBalancesRes = await openBalances;
    expect(openBalancesRes.status()).toBe(409);
    expect((await openBalancesRes.json()).code).toBe('OPEN_BALANCES');
    await expect(sheet).toBeVisible();
    await expect(sheetError).toContainText('Aún hay deudas sin saldar en este espacio. Saldadlas antes de archivarlo.');
    await expect(settleLink).toHaveAttribute('href', `/settle?space=${spaceId}`);
    await expect(header).toHaveText('Pareja · Cerrando cuentas');

    // B registers the 10 € payment (PENDING) while A's sheet is still open → 409 PENDING_SETTLEMENTS.
    const ctxB = await createAuthenticatedContext(newContext, userB);
    try {
      const paid = await ctxB.request.post('/api/settle', { data: { toUserId: userA.id, amount: 10, groupId: spaceId } });
      expect(paid.ok(), await paid.text()).toBeTruthy();
      const paidId = (await paid.json()).settlement.id as string;

      const pending = spacePatch(page, spaceId);
      await confirm.click();
      const pendingRes = await pending;
      expect(pendingRes.status()).toBe(409);
      const pendingBody = await pendingRes.json();
      expect(pendingBody).toMatchObject({ code: 'PENDING_SETTLEMENTS', settleUrl: `/settle?space=${spaceId}` });
      await expect(sheetError).toContainText('Hay un pago pendiente de confirmar. Confírmalo o recházalo antes de archivar el espacio.');
      await expect(settleLink).toHaveAttribute('href', `/settle?space=${spaceId}`);

      // A confirms it → at peace again; the same open sheet now archives.
      const confirmedB = await page.request.patch(`/api/settle/${paidId}/status`, { data: { status: 'CONFIRMED' } });
      expect(confirmedB.ok(), await confirmedB.text()).toBeTruthy();
    } finally {
      await ctxB.close();
    }

    const patchPromise = spacePatch(page, spaceId);
    await sheet.getByTestId('confirm-sheet-confirm').click();
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
    await expect(banner).toContainText('Solo lectura: puedes consultar lo compartido, pero no añadir ni cambiar nada.');
    await expect(page.getByTestId('space-status-close-link')).toHaveCount(0);

    // Expense detail: no edit/delete.
    await page.goto(`/expense/${expenseId}`);
    await expect(page.getByText('Este espacio está archivado: solo lectura.')).toBeVisible();
    await expect(page.locator(`a[href="/expense/${expenseId}/edit"]`)).toHaveCount(0);

    // Close flow: neither "start settling" nor "archive" any more.
    await page.goto(`/spaces/${spaceId}/close`);
    await expect(page.getByRole('heading', { level: 1, name: /Cerrar/ })).toBeVisible();
    await expect(page.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(page.getByTestId('close-archive')).toHaveCount(0);

    // New expenses are rejected with the archived message.
    const expenseRes = await postSharedExpense(page, '20.00', 'Gasto en archivado');
    expect(expenseRes.status()).toBe(409);
    expect((await expenseRes.json()).error).toBe('Este espacio está archivado (solo lectura)');

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

    await expect(page.getByTestId('space-header-status')).toHaveText('Pareja · Cerrando cuentas');
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
    await expect(page.getByRole('heading', { level: 1, name: /Cerrar/ })).toBeVisible();
    await expect(page.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(page.getByTestId('close-archive')).toHaveCount(0);

    // Server-side role gate (same session cookie): 403, status unchanged.
    const archive = await page.request.patch(`/api/spaces/${spaceId}`, { data: { status: 'ARCHIVED' } });
    expect(archive.status()).toBe(403);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-header-status')).toHaveText('Pareja · Cerrando cuentas');
  });
});
