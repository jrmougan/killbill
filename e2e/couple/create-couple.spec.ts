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

  test('user without a group sees the personal home with a "Crear un grupo" action', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    // A group-less user is fully usable in the personal home (no onboarding wall);
    // creating a group is a non-blocking action ("Crear un grupo") plus a join card.
    const createGroupBtn = page.getByRole('button', { name: /Crear un grupo/i });
    await expect(createGroupBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking "Crear un grupo" changes UI to show the group dashboard', async ({ page }) => {
    await loginAs(page, user);
    await expect(page).toHaveURL(/\/dashboard/);

    const createGroupBtn = page.getByRole('button', { name: /Crear un grupo/i });
    await expect(createGroupBtn).toBeVisible({ timeout: 10000 });

    // Submitting the form triggers a server action that creates the couple and
    // redirects. Wait for that POST to fully complete before touching the page so
    // we never abort the in-flight action (a premature reload/navigation does).
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15000 }),
      createGroupBtn.click(),
    ]);

    // The client-side RSC refresh after the redirect is racy under CI load (single
    // worker, standalone server) — the dashboard intermittently keeps showing the
    // onboarding view for a beat, which flaked this test as both a negative and a
    // positive assertion. The couple now exists (POST completed), so a fresh
    // navigation renders the couple view deterministically.
    await page.goto('/dashboard');

    // Group view rendered: the "Tu balance" card exists only once the user has a
    // group, and the create-group action is gone.
    await expect(page.getByText(/Tu balance/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Crear un grupo/i })).toHaveCount(0);
  });
});
