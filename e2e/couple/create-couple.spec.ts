import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Couple - Create', () => {
  let user: { email: string; password: string; id: string };
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'solo-user');
    user = data.user;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('user without couple sees onboarding screen with "Crear Pareja" button', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    // The onboarding shows a "Crear Pareja" button
    const createCoupleBtn = page.getByRole('button', { name: /Crear Pareja/i });
    await expect(createCoupleBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking "Crear Pareja" changes UI to show couple dashboard', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    const createCoupleBtn = page.getByRole('button', { name: /Crear Pareja/i });
    await expect(createCoupleBtn).toBeVisible({ timeout: 10000 });
    await createCoupleBtn.click();

    // After creating couple, should redirect back to dashboard with couple view
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // The onboarding button should no longer be visible.
    // The post-creation re-render (server roundtrip to create the couple, then a
    // dashboard re-render) can be slow under CI load, so wait it out with a generous
    // timeout instead of a fixed sleep + short window, which flaked intermittently.
    const onboardingBtn = page.getByRole('button', { name: /Crear Pareja/i });
    await expect(onboardingBtn).not.toBeVisible({ timeout: 15000 });
  });
});
