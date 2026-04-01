import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';

test.describe('Auth - Register', () => {
  let inviteCode: string;
  let adminEmail: string;
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'admin-with-invite');
    inviteCode = data.inviteCode;
    adminEmail = data.admin.email;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('successful registration with valid invite code redirects to /dashboard', async ({ page }) => {
    const uniqueEmail = `newuser_${Date.now()}@test.com`;

    await page.goto('/register');
    await page.fill('[data-testid="register-invite-code"]', inviteCode);
    await page.fill('[data-testid="register-name"]', 'New User');
    await page.fill('[data-testid="register-email"]', uniqueEmail);
    await page.fill('[data-testid="register-password"]', 'Password123');
    await page.click('[data-testid="register-submit"]');

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('registration with invalid invite code shows error', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="register-invite-code"]', 'INVALID1');
    await page.fill('[data-testid="register-name"]', 'Test User');
    await page.fill('[data-testid="register-email"]', `invalid_${Date.now()}@test.com`);
    await page.fill('[data-testid="register-password"]', 'Password123');
    await page.click('[data-testid="register-submit"]');

    const error = page.locator('[data-testid="register-error"]');
    await expect(error).toBeVisible();
  });

  test('registration with already registered email shows error', async ({ page }) => {
    // The admin user already exists - try to register with the same email
    // First we need a fresh valid code; since the main one may have been used,
    // use the admin email which is already taken
    await page.goto('/register');
    // Use a non-existent code so it fails early, or we can seed another invite
    // Actually we want to test the "email already exists" path:
    // The admin email is already in DB - but we need a valid invite code for it to reach that check.
    // Seed a new invite code via API
    const newInviteRes = await apiContext.post('/api/test/seed', {
      data: { scenario: 'admin-with-invite' },
    });
    const newData = await newInviteRes.json();

    await page.fill('[data-testid="register-invite-code"]', newData.inviteCode);
    await page.fill('[data-testid="register-name"]', 'Duplicate User');
    await page.fill('[data-testid="register-email"]', newData.admin.email); // already exists
    await page.fill('[data-testid="register-password"]', 'Password123');
    await page.click('[data-testid="register-submit"]');

    const error = page.locator('[data-testid="register-error"]');
    await expect(error).toBeVisible();
  });
});
