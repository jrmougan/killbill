import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// Scenario 'couple-with-personal-expense' seeds:
//  - a SHARED expense of 100€ paid by userA, split 50/50
//  - a PERSONAL expense of 500€ owned by userA (private)
// The partner (userB) must never see or be affected by the personal one.
test.describe('Personal expenses — privacy & sharing', () => {
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

  test('owner sees the personal expense on /personal', async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    await loginAs(page, data.userA as { email: string; password: string });

    await page.goto('/personal');
    await expect(page.getByText('Personal Expense')).toBeVisible({ timeout: 10000 });
  });

  test("partner's balance and views exclude the owner's personal expense", async ({ page }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    await loginAs(page, data.userB as { email: string; password: string });

    // Balance must reflect ONLY the shared 100€ (userB owes 50€), never the 500€.
    const balance = page.locator('[data-testid="balance-amount"]');
    await expect(balance).toBeVisible({ timeout: 10000 });
    const amount = parseFloat((await balance.textContent())?.replace(/[€\s+]/g, '').replace(',', '.') || '0');
    expect(amount).toBeLessThan(0);
    expect(amount).toBeGreaterThan(-100); // -50, NOT -300 (which is what a leak would produce)

    // The shared expense list must not contain the personal one.
    await page.goto('/expenses/list');
    await expect(page.getByText('Shared Expense')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Personal Expense')).toHaveCount(0);

    // The CSV export (uses the page's auth cookies) must exclude the personal one.
    const csv = await page.request.get('/api/export');
    const body = await csv.text();
    expect(body).toContain('Shared Expense');
    expect(body).not.toContain('Personal Expense');
  });

  test('owner can share a personal expense; re-sharing 409; non-owner 403', async ({ page, browser }) => {
    await resetDb(apiContext);
    const data = await seedScenario(apiContext, 'couple-with-personal-expense');
    const personalId = data.personalExpenseId as string;

    // Non-owner (userB) is forbidden.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginAs(pageB, data.userB as { email: string; password: string });
    const forbidden = await pageB.request.post(`/api/expenses/${personalId}/share`);
    expect(forbidden.status()).toBe(403);
    await ctxB.close();

    // Owner (userA) shares successfully, then a second share is a 409 conflict.
    await loginAs(page, data.userA as { email: string; password: string });
    const shared = await page.request.post(`/api/expenses/${personalId}/share`);
    expect(shared.status()).toBe(200);
    const again = await page.request.post(`/api/expenses/${personalId}/share`);
    expect(again.status()).toBe(409);

    // After sharing, it appears in the couple's shared list.
    await page.goto('/expenses/list');
    await expect(page.getByText('Personal Expense')).toBeVisible({ timeout: 10000 });
  });
});
