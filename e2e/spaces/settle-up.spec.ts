import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * Close/settle-up flow with two browser contexts (payer + creditor).
 *
 * What the code does (src/app/api/spaces/[id]/settle-up/route.ts):
 * - Only OWNER/ADMIN may call it; it moves ACTIVE → SETTLING and creates PENDING
 *   settlements for the debts of the CALLER only (the caller as payer).
 * - In the seeded couples the OWNER (userA) is the CREDITOR, so settle-up by the
 *   owner creates no settlement: the MEMBER debtor pays from /settle instead.
 * - To exercise generated suggestions, the third test makes the OWNER the debtor.
 * - /spaces/[id]/close lists only what the caller owes ("Lo que debes").
 * - Pending settlements never post to the ledger; confirming one does (once).
 */

type Creds = { email: string; password: string; id: string };

// Exact es-ES amounts (Intl inserts a NBSP before €, matched by \s).
const ZERO = /^0,00\s€$/;
const PLUS_50 = /^\+50,00\s€$/;
const MINUS_50 = /^-50,00\s€$/;
const FIFTY = /^50,00\s€$/;

async function startSettleUp(page: Page, spaceId: string) {
  const url = `/api/spaces/${spaceId}/settle-up`;
  let body: unknown;
  // Preserve the real API response before the successful action reloads the page.
  await page.route(`**${url}`, async (route) => {
    const response = await route.fetch();
    body = await response.json();
    await route.fulfill({ response });
  }, { times: 1 });
  const responsePromise = page.waitForResponse(
    (res) => res.url().endsWith(url) && res.request().method() === 'POST',
  );
  await page.getByTestId('close-start-settling').click();
  const response = await responsePromise;
  return { status: response.status(), body };
}

function settlementStatusPatch(page: Page) {
  return page.waitForResponse(
    (res) => /\/api\/settle\/[^/]+\/status$/.test(new URL(res.url()).pathname) && res.request().method() === 'PATCH',
  );
}

/** Creditor confirms the single pending settlement from their dashboard. */
async function confirmFromDashboard(page: Page, fromName: string) {
  await page.goto('/dashboard');
  await expect(page.getByText('Confirmar Pagos')).toBeVisible();
  await expect(page.getByText(`${fromName} te ha pagado`)).toBeVisible();
  await expect(page.getByTestId('pending-settlement').getByText(/^50,00\s€$/)).toBeVisible();
  const patchPromise = settlementStatusPatch(page);
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  const patch = await patchPromise;
  expect(patch.status()).toBe(200);
  await expect(page.getByText('Confirmar Pagos')).toHaveCount(0);
}

test.describe('Spaces - Settle-up (close flow)', () => {
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

  test('couple-with-debt: OWNER starts settle-up → SETTLING; debtor pays → PENDING 50,00 € in the checklist', async ({ newContext }) => {
    const data = await seedScenario(apiContext, 'couple-with-debt');
    const userA = data.userA as Creds; // OWNER, creditor (+50 €)
    const userB = data.userB as Creds; // MEMBER, debtor (−50 €)
    const spaceId = data.coupleId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Debtor's view of the close flow: the computed debt, but no manage actions.
    await pageB.goto(`/spaces/${spaceId}/close`);
    const debtRow = pageB.getByTestId('close-debt-row');
    await expect(debtRow).toHaveCount(1);
    await expect(debtRow).toContainText('Debes a User A');
    await expect(debtRow.getByTestId('close-amount')).toHaveText(FIFTY);
    await expect(pageB.getByTestId('close-start-settling')).toHaveCount(0);

    // Creditor/OWNER: owes nothing, starts the settle-up.
    await pageA.goto(`/spaces/${spaceId}/close`);
    await expect(pageA.getByTestId('close-no-debts')).toContainText('Estás al día');
    await expect(pageA.getByTestId('close-settlement-row')).toHaveCount(0);

    const settleUp = await startSettleUp(pageA, spaceId);
    expect(settleUp.status).toBe(200);
    // The caller is the creditor → nothing to suggest for them.
    expect(settleUp.body).toEqual({ success: true, status: 'SETTLING', suggested: [] });

    // SETTLING: the start button is gone, archive remains.
    await expect(pageA.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(pageA.getByTestId('close-archive')).toBeVisible();
    await pageA.goto(`/spaces/${spaceId}`);
    await expect(pageA.getByTestId('space-header-status')).toHaveText('Pareja · Liquidando');

    // The MEMBER debtor cannot drive settle-up (OWNER/ADMIN only)...
    const forbidden = await pageB.request.post(`/api/spaces/${spaceId}/settle-up`);
    expect(forbidden.status()).toBe(403);

    // ...so they pay from /settle, which SETTLING still allows.
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-balance')).toHaveText(FIFTY);
    const settlePromise = pageB.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST',
    );
    await pageB.getByRole('button', { name: 'Ya he pagado' }).click();
    expect((await settlePromise).ok()).toBeTruthy();
    await expect(pageB.getByTestId('settle-pending')).toContainText('Pendiente de que User A confirme');

    // Creditor's checklist: exactly one PENDING B → A of 50,00 €.
    await pageA.goto(`/spaces/${spaceId}/close`);
    const rows = pageA.getByTestId('close-settlement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'PENDING');
    await expect(rows.first()).toContainText('User B → User A');
    await expect(rows.first().getByTestId('close-amount')).toHaveText(FIFTY);
    await expect(pageA.getByTestId('close-progress')).toHaveText('0/1 confirmadas');

    // PENDING does not move balances.
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(PLUS_50);

    await ctxA.close();
    await ctxB.close();
  });

  test('space-settling: payer sees the pending settlement; creditor confirms → both balances 0,00 €', async ({ newContext }) => {
    const data = await seedScenario(apiContext, 'space-settling');
    const userA = data.userA as Creds; // OWNER, creditor
    const userB = data.userB as Creds; // MEMBER, payer
    const spaceId = data.coupleId as string;
    const settlementId = data.settlementId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Payer dashboard: SETTLING banner, still −50,00 €, pending settlement in the feed.
    await pageB.goto('/dashboard');
    await expect(pageB.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');
    await expect(pageB.getByTestId('balance-amount')).toHaveText(MINUS_50);
    const pendingCard = pageB.locator(`a[href="/settle/${settlementId}"]`);
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard).toContainText('Liquidación');
    await expect(pendingCard).toContainText('User B → User A');
    await expect(pendingCard).toContainText('Pendiente');
    await expect(pendingCard).toContainText(/50,00\s€/);
    // Only the receiver gets the confirm section.
    await expect(pageB.getByText('Confirmar Pagos')).toHaveCount(0);

    // Creditor confirms from their dashboard.
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(PLUS_50);
    await confirmFromDashboard(pageA, 'User B');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(ZERO);

    // Payer: balance 0,00 € and the Recientes row now reads as confirmed.
    await pageB.reload();
    await expect(pageB.getByTestId('balance-amount')).toHaveText(ZERO);
    const settledRow = pageB.locator(`a[href="/settle/${settlementId}"]`);
    await expect(settledRow).toContainText('Confirmado');
    await expect(settledRow).not.toContainText('Pendiente');

    // Close checklist: 1/1 confirmed.
    await pageA.goto(`/spaces/${spaceId}/close`);
    await expect(pageA.getByTestId('close-progress')).toHaveText('1/1 confirmadas');
    await expect(pageA.getByTestId('close-settlement-row')).toHaveAttribute('data-status', 'CONFIRMED');
    await expect(pageA.getByTestId('close-no-debts')).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test('repeating settle-up or confirming twice neither duplicates settlements nor re-counts money', async ({ newContext }) => {
    // Make the OWNER the debtor so settle-up generates a suggestion: B (MEMBER)
    // pays a 100 € shared expense split 50/50 → A owes B 50 €.
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    const userA = data.userA as Creds; // OWNER, debtor
    const userB = data.userB as Creds; // MEMBER, creditor
    const spaceId = data.coupleId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageB.goto('/expenses/new');
    await pageB.fill('[data-testid="expense-amount"]', '100.00');
    await pageB.fill('[data-testid="expense-description"]', 'Compra compartida');
    const expensePromise = pageB.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/expenses' && res.request().method() === 'POST',
    );
    await pageB.click('[data-testid="expense-submit"]');
    expect((await expensePromise).ok()).toBeTruthy();
    await expect(pageB).toHaveURL(/\/dashboard/);
    await expect(pageB.getByTestId('balance-amount')).toHaveText(PLUS_50);

    // Owner-debtor sees the computed debt and starts the settle-up from the UI.
    await pageA.goto(`/spaces/${spaceId}/close`);
    const debtRow = pageA.getByTestId('close-debt-row');
    await expect(debtRow).toContainText('Debes a User B');
    await expect(debtRow.getByTestId('close-amount')).toHaveText(FIFTY);

    const settleUp = await startSettleUp(pageA, spaceId);
    expect(settleUp.status).toBe(200);
    expect(settleUp.body).toEqual({
      success: true,
      status: 'SETTLING',
      suggested: [{ toUserId: userB.id, amount: 5000 }],
    });

    const rows = pageA.getByTestId('close-settlement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'PENDING');
    await expect(rows.first()).toContainText('User A → User B');
    await expect(rows.first().getByTestId('close-amount')).toHaveText(FIFTY);

    // Re-running settle-up (twice) is idempotent: no new PENDING row.
    for (let i = 0; i < 2; i++) {
      const again = await pageA.request.post(`/api/spaces/${spaceId}/settle-up`);
      expect(again.status()).toBe(200);
      expect(await again.json()).toEqual({ success: true, status: 'SETTLING', suggested: [] });
    }
    await pageA.reload();
    await expect(rows).toHaveCount(1);
    await expect(pageA.getByTestId('close-progress')).toHaveText('0/1 confirmadas');

    // Payer's dashboard: pending card, balance still −50,00 € (PENDING never posts).
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(MINUS_50);
    const pendingCards = pageA.locator('a[href^="/settle/"]', { hasText: 'Liquidación' });
    await expect(pendingCards).toHaveCount(1);
    await expect(pendingCards.first()).toContainText('Pendiente');
    const settlementId = (await pendingCards.first().getAttribute('href'))?.split('/').pop();
    expect(settlementId).toBeTruthy();

    // Creditor confirms once from the UI...
    await confirmFromDashboard(pageB, 'User A');
    await expect(pageB.getByTestId('balance-amount')).toHaveText(ZERO);

    // ...and a second confirmation of the same settlement is refused (409 SETTLEMENT_NOT_PENDING).
    const second = await pageB.request.patch(`/api/settle/${settlementId}/status`, {
      data: { status: 'CONFIRMED' },
    });
    expect(second.status()).toBe(409);

    // Settle-up after full payment suggests nothing new.
    const afterPaid = await pageA.request.post(`/api/spaces/${spaceId}/settle-up`);
    expect(afterPaid.status()).toBe(200);
    expect(await afterPaid.json()).toEqual({ success: true, status: 'SETTLING', suggested: [] });

    // Money counted exactly once: both at 0,00 €, one settlement, confirmed.
    await pageB.reload();
    await expect(pageB.getByTestId('balance-amount')).toHaveText(ZERO);
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(ZERO);
    await pageA.goto(`/spaces/${spaceId}/close`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'CONFIRMED');
    await expect(pageA.getByTestId('close-progress')).toHaveText('1/1 confirmadas');
    await expect(pageA.getByTestId('close-no-debts')).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
