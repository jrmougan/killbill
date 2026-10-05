import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import mariadb from 'mariadb';

/** The legacy 6-hex `Couple.code` of a seeded space (still stored, never an invitation). */
async function legacyCode(coupleId: string): Promise<string> {
  const conn = await mariadb.createConnection({
    host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  try {
    const [row] = await conn.query('SELECT code FROM Couple WHERE id = ?', [coupleId]);
    return row.code as string;
  } finally {
    await conn.end();
  }
}

test.describe('Auth - Register', () => {
  let inviteCode: string;
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    });
    const data = await seedScenario(apiContext, 'admin-with-invite');
    inviteCode = data.inviteCode;
  });

  test.afterAll(async () => {
    await resetDb(apiContext);
    await apiContext.dispose();
  });

  test('successful registration with a valid admin invite code lands on the /welcome onboarding', async ({ page }) => {
    const uniqueEmail = `newuser_${Date.now()}@test.com`;

    await page.goto('/register');
    await page.fill('[data-testid="register-invite-code"]', inviteCode);
    await page.fill('[data-testid="register-name"]', 'New User');
    await page.fill('[data-testid="register-email"]', uniqueEmail);
    await page.fill('[data-testid="register-password"]', 'Password123');
    await page.click('[data-testid="register-submit"]');

    // A brand-new account without a space gets the optional onboarding (IE-09).
    await expect(page).toHaveURL(/\/welcome/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: '¿Con quién compartes gastos?' })).toBeVisible();
  });

  test('a legacy 6-hex space code is not a registration invitation (no short codes)', async ({ page }) => {
    const seed = await seedScenario(apiContext, 'couple-with-debt');
    const code = await legacyCode(seed.coupleId as string);

    await page.goto('/register');
    await page.fill('[data-testid="register-invite-code"]', code);
    await page.fill('[data-testid="register-name"]', 'Intruder');
    await page.fill('[data-testid="register-email"]', `intruder_${Date.now()}@test.com`);
    await page.fill('[data-testid="register-password"]', 'Password123');
    await page.click('[data-testid="register-submit"]');

    await expect(page.locator('[data-testid="register-error"]')).toContainText('Código de invitación inválido');
    await expect(page).toHaveURL(/\/register/);
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
