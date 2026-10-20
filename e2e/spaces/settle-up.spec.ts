import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * Close/settle-up flow with two browser contexts (payer + creditor).
 *
 * What the code does:
 * - /spaces/[id]/close "Empezar a cerrar cuentas" only PATCHes the space to
 *   SETTLING (OWNER/ADMIN): it never calls settle-up, so no PENDING payment is
 *   created on anyone's behalf. Debtors pay from /settle ("Ya le he pagado").
 * - POST /api/spaces/[id]/settle-up still exists (API only): ACTIVE → SETTLING plus
 *   PENDING settlements for the CALLER's debts; the third test pins that contract
 *   (suggested + PENDING row) and the fourth that re-runs stay idempotent.
 * - /close step 2 lists every debt of the space (mine as "Debes a X") and the
 *   PENDING payments; CONFIRMED history is not listed.
 * - Pending settlements never post to the ledger; confirming one does (once).
 */

type Creds = { email: string; password: string; id: string };

// Exact es-ES amounts (Intl inserts a NBSP before €, matched by \s).
const ZERO = /^0,00\s€$/;
const PLUS_50 = /^\+50,00\s€$/;
const MINUS_50 = /^-50,00\s€$/;
const FIFTY = /^50,00\s€$/;

/** "Empezar a cerrar cuentas" on /close: review sheet → PATCH /api/spaces/[id] {status:'SETTLING'}. */
async function startSettling(page: Page, spaceId: string) {
  const url = `/api/spaces/${spaceId}`;
  const responsePromise = page.waitForResponse(
    (res) => new URL(res.url()).pathname === url && res.request().method() === 'PATCH',
  );
  await page.getByTestId('close-start-settling').click();
  await expect(page.getByTestId('settle-sheet')).toBeVisible();
  await page.getByTestId('confirm-sheet-confirm').click();
  const response = await responsePromise;
  expect(response.request().postDataJSON()).toEqual({ status: 'SETTLING' });
  return { status: response.status() };
}

/** Debtor registers the payment from /settle ("Ya le he pagado" + review sheet) → PENDING. */
async function payFromSettle(page: Page, spaceId: string, toName: string) {
  await page.goto(`/settle?space=${spaceId}`);
  const settlePromise = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Ya le he pagado/ }).click();
  await page.getByTestId('confirm-sheet-confirm').click();
  expect((await settlePromise).ok()).toBeTruthy();
  await expect(page.getByTestId('settle-pending')).toContainText(`Pago a ${toName} · por confirmar`);
}

function settlementStatusPatch(page: Page) {
  return page.waitForResponse(
    (res) => /\/api\/settle\/[^/]+\/status$/.test(new URL(res.url()).pathname) && res.request().method() === 'PATCH',
  );
}

/** Creditor confirms the single pending settlement from their dashboard. */
async function confirmFromDashboard(page: Page, fromName: string) {
  await page.goto('/dashboard');
  await expect(page.getByText(/^Pagos por confirmar · 1$/)).toBeVisible();
  await expect(page.getByTestId('pending-settlement').getByText(`${fromName} dice que te ha pagado`)).toBeVisible();
  await expect(page.getByTestId('pending-settlement').getByText(/^50,00\s€$/)).toBeVisible();
  await page.getByRole('button', { name: 'Lo he recibido', exact: true }).click();
  const patchPromise = settlementStatusPatch(page);
  await page.getByTestId('confirm-sheet-confirm').click();
  const patch = await patchPromise;
  expect(patch.status()).toBe(200);
  await expect(page.getByText(/Pagos por confirmar/)).toHaveCount(0);
  await expect(page.getByText(`Deuda saldada: ${fromName} ya no te debe nada`)).toBeVisible();
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
    await expect(pageA.getByTestId('close-no-debts')).toContainText('Tú no debes nada');
    await expect(pageA.getByTestId('close-settlement-row')).toHaveCount(0);
    // Step 2 lists every debt of the space, worded for the viewer.
    await expect(pageA.getByTestId('close-plan-row')).toContainText('User B te debe');
    await expect(pageA.getByTestId('close-plan-row')).toContainText('Esperando a User B');
    await expect(pageA.getByTestId('close-progress')).toHaveText('Faltan 1');

    const settling = await startSettling(pageA, spaceId);
    expect(settling.status).toBe(200);

    // SETTLING: the start button is gone, archive remains.
    await expect(pageA.getByTestId('close-start-settling')).toHaveCount(0);
    await expect(pageA.getByTestId('close-archive')).toBeVisible();
    await pageA.goto(`/spaces/${spaceId}`);
    await expect(pageA.getByTestId('space-header-status')).toHaveText('Pareja · Cerrando cuentas');

    // The MEMBER debtor cannot drive settle-up (OWNER/ADMIN only)...
    const forbidden = await pageB.request.post(`/api/spaces/${spaceId}/settle-up`);
    expect(forbidden.status()).toBe(403);

    // ...so they pay from /settle, which SETTLING still allows.
    await pageB.goto('/settle');
    await expect(pageB.getByTestId('settle-balance')).toHaveText(FIFTY);
    const settlePromise = pageB.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/settle' && res.request().method() === 'POST',
    );
    await pageB.getByRole('button', { name: /^Ya le he pagado/ }).click();
    await pageB.getByTestId('confirm-sheet-confirm').click();
    expect((await settlePromise).ok()).toBeTruthy();
    await expect(pageB.getByTestId('settle-pending')).toContainText('Pago a User A · por confirmar');

    // Creditor's checklist: exactly one PENDING B → A of 50,00 €.
    await pageA.goto(`/spaces/${spaceId}/close`);
    const rows = pageA.getByTestId('close-settlement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'PENDING');
    await expect(rows.first()).toContainText('User B dice que te ha pagado');
    await expect(rows.first().getByRole('link', { name: 'Revisar pago' })).toHaveAttribute('href', /^\/settle\/[^/]+$/);
    await expect(rows.first().getByTestId('close-amount')).toHaveText(FIFTY);
    // The PENDING covers the planned debt: it is not listed twice.
    await expect(pageA.getByTestId('close-plan-row')).toHaveCount(0);
    await expect(pageA.getByTestId('close-progress')).toHaveText('Faltan 1');

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
    await expect(pendingCard).toContainText('Pago de deuda');
    await expect(pendingCard).toContainText('Pago a User A · por confirmar');
    await expect(pendingCard).toContainText('Pendiente');
    await expect(pendingCard).toContainText(/50,00\s€/);
    // Only the receiver gets the confirm section.
    await expect(pageB.getByText(/Pagos por confirmar/)).toHaveCount(0);

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

    // Close checklist: nothing left (CONFIRMED history is not listed).
    await pageA.goto(`/spaces/${spaceId}/close`);
    await expect(pageA.getByTestId('close-progress')).toHaveText('Al día');
    await expect(pageA.getByTestId('close-settlement-row')).toHaveCount(0);
    await expect(pageA.getByTestId('close-no-debts')).toContainText('Estáis al día');

    // SETTLING with every balance at zero: only the OWNER is offered to archive.
    await pageA.goto(`/settle?space=${spaceId}`);
    await expect(pageA.getByTestId('settle-peace')).toContainText('Estáis al día');
    await pageA.getByTestId('settle-archive').click();
    await expect(pageA).toHaveURL(`/spaces/${spaceId}/close`);
    await pageB.goto(`/settle?space=${spaceId}`);
    await expect(pageB.getByTestId('settle-archive-hint')).toHaveText('Avisa a quien gestiona el espacio para archivarlo.');
    await expect(pageB.getByTestId('settle-archive')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('API settle-up in ACTIVE: SETTLING + one PENDING for the OWNER-debtor, idempotent on re-run', async ({ newContext }) => {
    // B (MEMBER) pays a 100 € shared expense split 50/50 → A (OWNER) owes B 50 €.
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    const userA = data.userA as Creds; // OWNER, debtor
    const userB = data.userB as Creds; // MEMBER, creditor
    const spaceId = data.coupleId as string;

    const ctxA = await createAuthenticatedContext(newContext, userA);
    const ctxB = await createAuthenticatedContext(newContext, userB);
    const expense = await ctxB.request.post('/api/expenses', {
      data: { description: 'Compra compartida', amount: '100.00', category: 'other', groupId: spaceId },
    });
    expect(expense.ok(), await expense.text()).toBeTruthy();

    // First call: ACTIVE → SETTLING and the caller's debt as a PENDING suggestion.
    const first = await ctxA.request.post(`/api/spaces/${spaceId}/settle-up`);
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ success: true, status: 'SETTLING', suggested: [{ toUserId: userB.id, amount: 5000 }] });

    // Re-running creates nothing new.
    const again = await ctxA.request.post(`/api/spaces/${spaceId}/settle-up`);
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ success: true, status: 'SETTLING', suggested: [] });

    // Exactly one PENDING A → B of 50,00 € exists, and the space is SETTLING.
    const pageA = await ctxA.newPage();
    await pageA.goto(`/spaces/${spaceId}/close`);
    const rows = pageA.getByTestId('close-settlement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'PENDING');
    await expect(rows.first()).toContainText('Pago a User B · por confirmar');
    await expect(rows.first().getByTestId('close-amount')).toHaveText(FIFTY);
    await expect(pageA.getByTestId('close-start-settling')).toHaveCount(0);

    // The creditor gets it to confirm; PENDING does not move balances yet.
    const pageB = await ctxB.newPage();
    await pageB.goto('/dashboard');
    await expect(pageB.getByText(/^Pagos por confirmar · 1$/)).toBeVisible();
    await expect(pageB.getByTestId('pending-settlement').getByText(/^50,00\s€$/)).toBeVisible();
    await expect(pageB.getByTestId('balance-amount')).toHaveText(PLUS_50);

    await ctxA.close();
    await ctxB.close();
  });

  test('repeating settle-up or confirming twice neither duplicates settlements nor re-counts money', async ({ newContext }) => {
    // Make the OWNER the debtor (the one settle-up would create a suggestion
    // for): B (MEMBER) pays a 100 € shared expense split 50/50 → A owes B 50 €.
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

    // Owner-debtor sees the computed debt and starts closing from the UI: a plain
    // PATCH to SETTLING that creates no PENDING payment on their behalf.
    await pageA.goto(`/spaces/${spaceId}/close`);
    const debtRow = pageA.getByTestId('close-debt-row');
    await expect(debtRow).toContainText('Debes a User B');
    await expect(debtRow.getByTestId('close-amount')).toHaveText(FIFTY);

    const settling = await startSettling(pageA, spaceId);
    expect(settling.status).toBe(200);
    await expect(pageA.getByTestId('close-start-settling')).toHaveCount(0);
    const rows = pageA.getByTestId('close-settlement-row');
    await expect(rows).toHaveCount(0);
    await expect(debtRow).toContainText('Debes a User B');

    // The creditor has nothing to confirm yet.
    await pageB.goto('/dashboard');
    await expect(pageB.getByTestId('balance-amount')).toHaveText(PLUS_50);
    await expect(pageB.getByText(/Pagos por confirmar/)).toHaveCount(0);

    // The debtor registers the payment from /settle → one PENDING A → B.
    await payFromSettle(pageA, spaceId, 'User B');
    await pageA.goto(`/spaces/${spaceId}/close`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-status', 'PENDING');
    await expect(rows.first()).toContainText('Pago a User B · por confirmar');
    await expect(rows.first()).toContainText('Falta que User B lo confirme');
    await expect(rows.first().getByTestId('close-amount')).toHaveText(FIFTY);
    await expect(debtRow).toHaveCount(0);
    await expect(pageA.getByTestId('close-progress')).toHaveText('Faltan 1');

    // Re-running settle-up (twice) is idempotent: no new PENDING row.
    for (let i = 0; i < 2; i++) {
      const again = await pageA.request.post(`/api/spaces/${spaceId}/settle-up`);
      expect(again.status()).toBe(200);
      expect(await again.json()).toEqual({ success: true, status: 'SETTLING', suggested: [] });
    }
    await pageA.reload();
    await expect(rows).toHaveCount(1);
    await expect(pageA.getByTestId('close-progress')).toHaveText('Faltan 1');

    // Payer's dashboard: pending card, balance still −50,00 € (PENDING never posts).
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('balance-amount')).toHaveText(MINUS_50);
    const pendingCards = pageA.locator('a[href^="/settle/"]', { hasText: 'Pago de deuda' });
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
    await expect(rows).toHaveCount(0);
    await expect(pageA.getByTestId('close-progress')).toHaveText('Al día');
    await expect(pageA.getByTestId('close-no-debts')).toContainText('Estáis al día');

    await ctxA.close();
    await ctxB.close();
  });
});
