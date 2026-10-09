import { test, expect, type NewContext } from '../fixtures/test.fixture';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { createAuthenticatedContext } from '../fixtures/auth.fixture';

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';

type Creds = { email: string; password: string; id?: string };
type EphemeralSeed = {
  owner: Creds;
  guest: { id: string; sessionToken: string };
  coupleId: string;
};

async function guestContext(newContext: NewContext, sessionToken: string): Promise<BrowserContext> {
  const context = await newContext();
  await context.addCookies([{ name: 'session_token', value: sessionToken, url: baseURL }]);
  return context;
}

/** The trip owner mints a fresh GUEST link (plaintext token is returned once). */
async function guestLink(owner: APIRequestContext, spaceId: string): Promise<string> {
  const res = await owner.post(`/api/spaces/${spaceId}/invites`, { data: { kind: 'GUEST' } });
  expect(res.status()).toBe(200);
  return (await res.json()).token as string;
}

test.describe('Guest confinement and invite links (QA P0)', () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
  });

  test('IE-01/IE-08/SEC-01: a guest session cannot escape its trip through the API', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const ctx = await guestContext(newContext, seed.guest.sessionToken);
    const api = ctx.request;

    const forbidden: Array<[string, string, unknown?]> = [
      ['POST', '/api/spaces', { type: 'GROUP', name: 'Escapado' }],
      ['GET', '/api/me/lists'],
      ['POST', '/api/me/lists', { name: 'Mía' }],
      ['GET', '/api/me/categories'],
      ['POST', '/api/tags', { name: 'guesttag' }],
      ['GET', '/api/budget'],
      ['POST', '/api/budget', { category: 'food', amount: 50 }],
      ['DELETE', '/api/budget?id=whatever'],
      ['PATCH', '/api/user/profile', { name: 'Hacker' }],
      ['GET', '/api/me/tokens'],
      ['POST', '/api/me/tokens', { name: 'Escapado', expiresInDays: 30 }],
      ['DELETE', '/api/me/tokens/whatever'],
      ['POST', `/api/spaces/${seed.coupleId}/invites`, { kind: 'GUEST' }],
      ['GET', '/api/export'],
    ];
    for (const [method, url, data] of forbidden) {
      const res = await api.fetch(url, { method, data });
      expect(res.status(), `${method} ${url}`).toBe(403);
    }

    // The guest surface keeps working.
    expect((await api.get('/api/expenses?scope=shared')).status()).toBe(200);
    expect((await api.get(`/api/spaces/${seed.coupleId}/balance`)).status()).toBe(200);
    const tags = await api.get('/api/tags');
    expect(tags.status()).toBe(200);
    for (const tag of (await tags.json()).tags as Array<{ coupleId: string | null }>) {
      expect(tag.coupleId).toBe(seed.coupleId);
    }
    await ctx.close();
  });

  test('IE-08/T-12: guest pages outside the guest surface bounce to /dashboard', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const ctx = await guestContext(newContext, seed.guest.sessionToken);
    const page = await ctx.newPage();
    for (const path of ['/categories', '/tags', '/spaces', `/spaces/${seed.coupleId}`, '/spaces/new', '/welcome', '/month']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard/);
    }
    await ctx.close();
  });

  test('IE-02: a logged-in user opening a guest link keeps the session and can join with the account', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const owner = await createAuthenticatedContext(newContext, seed.owner);
    const token = await guestLink(owner.request, seed.coupleId);

    const other = await seedScenario(request, 'couple-with-debt');
    const member = await createAuthenticatedContext(newContext, other.userA as Creds);

    // The API refuses to silently swap the registered session for a guest one.
    const silent = await member.request.post('/api/invites/claim', { data: { token, name: 'Ana' } });
    expect(silent.status()).toBe(409);
    expect((await silent.json()).code).toBe('SESSION_EXISTS');

    const page = await member.newPage();
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('heading', { name: /Te han invitado a Ephemeral Trip/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar como invitado' })).toBeVisible();

    await page.getByRole('button', { name: 'Unirme con mi cuenta' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('[data-testid="guest-banner"]')).toHaveCount(0);

    const spaces = await member.request.get('/api/spaces');
    expect(spaces.status()).toBe(200);
    expect(((await spaces.json()).spaces as Array<{ id: string }>).some((s) => s.id === seed.coupleId)).toBe(true);

    // Still a registered session: the member-only surface is reachable.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await owner.close();
    await member.close();
  });

  test('IE-02: entering as guest over a registered session needs an explicit confirmation', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const owner = await createAuthenticatedContext(newContext, seed.owner);
    const token = await guestLink(owner.request, seed.coupleId);
    const other = await seedScenario(request, 'couple-with-debt');
    const member = await createAuthenticatedContext(newContext, other.userB as Creds);

    const page = await member.newPage();
    await page.goto(`/i/${token}`);
    await page.getByRole('button', { name: 'Entrar como invitado' }).click();
    await expect(page.getByRole('note')).toContainText('cerrará tu sesión');
    await page.getByLabel('Tu nombre').fill('Bea');
    await page.getByRole('button', { name: 'Cerrar sesión y entrar como invitado' }).click();
    await expect(page.getByTestId('guest-recovery')).toBeVisible({ timeout: 10000 });
    await owner.close();
    await member.close();
  });

  test('IE-03: the personal recovery link re-opens the guest session on another device', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const owner = await createAuthenticatedContext(newContext, seed.owner);
    const token = await guestLink(owner.request, seed.coupleId);

    const phone = await newContext();
    const page = await phone.newPage();
    await page.goto(`/i/${token}`);
    await page.getByLabel('Tu nombre').fill('Marta');
    await page.getByRole('button', { name: 'Entrar como invitado' }).click();
    const recovery = page.getByTestId('guest-recovery');
    await expect(recovery).toBeVisible({ timeout: 10000 });
    const recoveryUrl = (await recovery.locator('.font-mono').innerText()).trim();
    expect(recoveryUrl).toMatch(/\/i\/[A-Za-z0-9_-]{40,}$/);

    const laptop = await newContext();
    const other = await laptop.newPage();
    await other.goto(new URL(recoveryUrl).pathname);
    await expect(other.getByRole('heading', { name: /Vuelve a Ephemeral Trip/ })).toBeVisible();
    await other.getByRole('button', { name: 'Entrar como Marta' }).click();
    await expect(other).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(other.locator('[data-testid="guest-banner"]')).toBeVisible();
    await owner.close();
    await phone.close();
    await laptop.close();
  });

  test('IE-07: "Regístrate" from a guest link creates an account that joins the trip', async ({ request, newContext }) => {
    const seed = (await seedScenario(request, 'ephemeral-with-guest')) as unknown as EphemeralSeed;
    const owner = await createAuthenticatedContext(newContext, seed.owner);
    const token = await guestLink(owner.request, seed.coupleId);

    const visitor = await newContext();
    const page = await visitor.newPage();
    await page.goto(`/i/${token}`);
    await page.getByRole('link', { name: 'Regístrate' }).click();
    await expect(page).toHaveURL(/\/register\?code=/);
    await page.getByLabel('Nombre').fill('Carla');
    await page.getByLabel('Email').fill(`carla_${Date.now()}@test.com`);
    await page.getByLabel('Contraseña').fill('Password123');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('[data-testid="guest-banner"]')).toHaveCount(0);

    const spaces = await visitor.request.get('/api/spaces');
    expect(((await spaces.json()).spaces as Array<{ id: string }>).some((s) => s.id === seed.coupleId)).toBe(true);
    await owner.close();
    await visitor.close();
  });
});
