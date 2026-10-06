import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Auth - Login', () => {
  let credentials: { email: string; password: string };
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'solo-user');
    credentials = data.user!;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('successful login redirects to /dashboard', async ({ page }) => {
    await loginAs(page, credentials);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('a first-run account (no space, no expense) lands on the /welcome onboarding', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(credentials.email);
    await page.getByLabel('Contraseña').fill(credentials.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/welcome/, { timeout: 10000 });
  });

  test('a user with a space lands on /dashboard', async ({ page }) => {
    const seed = await seedScenario(apiContext, 'couple-with-debt');
    const userA = seed.userA as { email: string; password: string };
    await page.goto('/login');
    await page.getByLabel('Email').fill(userA.email);
    await page.getByLabel('Contraseña').fill(userA.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('wrong password shows error on page', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"]', credentials.email);
    await page.fill('[data-testid="login-password"]', 'WrongPassword999');
    await page.click('[data-testid="login-submit"]');

    const error = page.locator('[data-testid="login-error"]');
    await expect(error).toBeVisible();
  });

  test('unauthenticated user visiting /dashboard is redirected to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout redirects to /login', async ({ page }) => {
    await loginAs(page, credentials);
    await expect(page).toHaveURL(/\/dashboard/);

    // Call logout API directly
    await page.request.post('/api/auth/logout');

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
