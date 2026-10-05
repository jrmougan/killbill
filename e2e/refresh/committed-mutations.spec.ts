import { test, expect } from '../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { createAuthenticatedContext, loginAs } from '../fixtures/auth.fixture';

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

test.afterEach(async ({ request }) => {
  await resetDb(request);
});

// A full reload would heal a stuck React transition and hide this regression.
async function watchDocument(page: Page) {
  const documentId = await page.evaluate(() => {
    const id = crypto.randomUUID();
    Object.assign(window, { refreshRegressionDocumentId: id });
    return id;
  });
  const navigations: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
  });
  return async () => {
    expect(navigations, 'mutations must reconcile RSC without document navigation').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { refreshRegressionDocumentId: string }).refreshRegressionDocumentId)).toBe(documentId);
  };
}

test('lifecycle refreshes update the header and actions repeatedly in the same document', async ({ page }) => {
  const data = await seedScenario(page.request, 'couple-no-expenses');
  await loginAs(page, data.userA as { email: string; password: string });
  await page.goto(`/spaces/${data.coupleId}`);
  const assertSameDocument = await watchDocument(page);
  const header = page.getByTestId('space-header-status');
  for (let cycle = 0; cycle < 10; cycle++) {
    await page.getByTestId('space-action-settle').click();
    await expect(header).toHaveAttribute('data-status', 'SETTLING');
    await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'SETTLING');
    await page.getByTestId('space-action-reopen').click();
    await expect(header).toHaveAttribute('data-status', 'ACTIVE');
    await expect(page.getByTestId('space-status-banner')).toHaveCount(0);
    await assertSameDocument();
  }
});

test('starting settle-up refreshes the suggested payment checklist without reloading', async ({ page, newContext }) => {
  const data = await seedScenario(page.request, 'couple-no-expenses');
  const creditorContext = await createAuthenticatedContext(newContext, data.userB as { email: string; password: string });
  const creditorPage = await creditorContext.newPage();
  await creditorPage.goto('/expenses/new');
  await creditorPage.getByTestId('expense-amount').fill('100.00');
  await creditorPage.getByTestId('expense-description').fill('Compra para cerrar');
  await creditorPage.getByTestId('expense-submit').click();
  await expect(creditorPage).toHaveURL(/\/dashboard/);
  await expect(creditorPage.getByTestId('balance-amount')).toHaveText(/^\+50,00\s€$/);

  await loginAs(page, data.userA as { email: string; password: string });
  await page.goto(`/spaces/${data.coupleId}/close`);
  await expect(page.getByTestId('close-debt-row')).toContainText('User B');
  const assertSameDocument = await watchDocument(page);
  const mutation = page.waitForResponse(response => response.url().endsWith(`/api/spaces/${data.coupleId}/settle-up`) && response.request().method() === 'POST');
  await page.getByTestId('close-start-settling').click();
  expect((await mutation).ok()).toBeTruthy();
  await expect(page.getByTestId('close-start-settling')).toHaveCount(0);
  await expect(page.getByTestId('close-progress')).toHaveText('0/1 confirmadas');
  await expect(page.getByTestId('close-settlement-row')).toHaveAttribute('data-status', 'PENDING');
  await expect(page.getByTestId('close-settlement-row')).toContainText(/50,00\s€$/);
  await assertSameDocument();
});

test('confirming a payment refreshes both the pending card and exact balance', async ({ page }) => {
  const data = await seedScenario(page.request, 'couple-with-pending-settlement');
  await loginAs(page, data.userA as { email: string; password: string });
  await expect(page.getByTestId('balance-amount')).toHaveText(/^\+50,00\s€$/);
  const assertSameDocument = await watchDocument(page);
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Confirmar Pagos', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('balance-amount')).toHaveText(/^0,00\s€$/);
  await assertSameDocument();
});

test('promoting a personal expense refreshes its visibility and splits without reloading', async ({ page }) => {
  const data = await seedScenario(page.request, 'couple-with-personal-expense');
  await loginAs(page, data.userA as { email: string; password: string });
  await page.goto(`/expense/${data.personalExpenseId}`);
  const assertSameDocument = await watchDocument(page);
  await expect(page.getByText('Gasto personal — privado, solo tú lo ves')).toBeVisible();
  await page.getByTestId('expense-promote').click();
  await page.getByTestId('expense-promote-confirm').click();
  await expect(page.getByTestId('expense-promote')).toHaveCount(0);
  await expect(page.getByText('Gasto personal — privado, solo tú lo ves')).toHaveCount(0);
  await expect(page.getByText('Reparto del gasto', { exact: true })).toBeVisible();
  await expect(page.getByText('User B', { exact: true })).toBeVisible();
  await expect(page.getByText(/^250,00\s€$/)).toHaveCount(2);
  await assertSameDocument();
});


test('archiving from close navigates to the fresh dashboard in the same document', async ({ page }) => {
  const data = await seedScenario(page.request, 'couple-no-expenses');
  await loginAs(page, data.userA as { email: string; password: string });
  await page.goto(`/spaces/${data.coupleId}/close`);
  const assertSameDocument = await watchDocument(page);
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('close-archive').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId('space-status-banner')).toHaveAttribute('data-status', 'ARCHIVED');
  await assertSameDocument();
});
