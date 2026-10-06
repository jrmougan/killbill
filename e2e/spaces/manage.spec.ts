import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs, createAuthenticatedContext } from '../fixtures/auth.fixture';

/**
 * Space management (/spaces/[id]) and the Inicio/Espacios rules around it:
 * rename, roles, leaving (LAST_OWNER / HAS_BALANCE), archived read-only,
 * invite-link reuse, half-open month totals and the trip end date.
 */

type Creds = { email: string; password: string; id: string };

function madridDate(offsetMonths = 0, day = 15): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value) - 1 + offsetMonths;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

test.describe('Spaces - Management', () => {
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

  test('group: per-member balances on Inicio; OWNER renames; MEMBER cannot', async ({ page, newContext }) => {
    const data = await seedScenario(apiContext, 'group-of-3');
    const userA = data.userA as Creds; // OWNER, +66,66 €
    const spaceId = data.coupleId as string;

    await loginAs(page, userA);
    const balances = page.getByTestId('member-balances');
    await expect(balances).toContainText('Saldos del grupo');
    const rows = balances.getByTestId('member-balance-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Tú');
    await expect(rows.first()).toContainText(/\+66,66\s€/);

    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Group of 3');
    await page.getByTestId('rename-space').click();
    const field = page.getByLabel('Nombre', { exact: true });
    await field.fill('   ');
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await field.fill('Piso Lavapiés');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Piso Lavapiés');
    await page.goto('/dashboard');
    await expect(page.getByTestId('space-card-active')).toContainText('Piso Lavapiés');

    const ctxB = await createAuthenticatedContext(newContext, data.userB as Creds);
    const pageB = await ctxB.newPage();
    await pageB.goto(`/spaces/${spaceId}`);
    await expect(pageB.getByTestId('rename-space')).toHaveCount(0);
    const forbidden = await pageB.request.patch(`/api/spaces/${spaceId}`, { data: { name: 'Hack' } });
    expect(forbidden.status()).toBe(403);
  });

  test('leaving: HAS_BALANCE asks to confirm, LAST_OWNER blocks until someone else is owner', async ({ page, newContext }) => {
    const data = await seedScenario(apiContext, 'group-of-3');
    const userA = data.userA as Creds; // OWNER
    const userC = data.userC as Creds; // MEMBER, owes 33,33 €
    const spaceId = data.coupleId as string;

    // C owes money: the sheet explains it and offers "Salir igualmente" (?force=1).
    const ctxC = await createAuthenticatedContext(newContext, userC);
    const pageC = await ctxC.newPage();
    await pageC.goto(`/spaces/${spaceId}`);
    await pageC.getByTestId('leave-space').click();
    const first = pageC.waitForResponse((r) => r.url().includes(`/members/${userC.id}`) && r.request().method() === 'DELETE');
    await pageC.getByTestId('leave-sheet').getByTestId('confirm-sheet-confirm').click();
    const blocked = await first;
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'HAS_BALANCE', balanceCents: -3333 });
    const sheet = pageC.getByTestId('leave-sheet');
    await expect(sheet).toContainText(/Todavía debes 33,33\s€/);
    await expect(sheet.getByRole('link', { name: /Ir a liquidar/ })).toHaveAttribute('href', `/settle?space=${spaceId}`);
    const forced = pageC.waitForResponse((r) => r.url().includes(`/members/${userC.id}?force=1`));
    await sheet.getByRole('button', { name: 'Salir igualmente' }).click();
    expect((await forced).status()).toBe(200);
    await expect(pageC).toHaveURL(/\/dashboard/);

    // A is the only OWNER and B remains: LAST_OWNER, not overridable.
    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);
    await page.getByTestId('leave-space').click();
    await page.getByTestId('leave-sheet').getByTestId('confirm-sheet-confirm').click();
    await expect(page.getByTestId('leave-sheet')).toContainText('Eres la única persona propietaria');
    const forcedOwner = await page.request.delete(`/api/spaces/${spaceId}/members/${userA.id}?force=1`);
    expect(forcedOwner.status()).toBe(409);
    expect((await forcedOwner.json()).code).toBe('LAST_OWNER');
    await page.getByTestId('leave-sheet').getByRole('button', { name: 'Entendido' }).click();

    // Make B owner from the member sheet → A may leave (A is owed money: force).
    await page.getByRole('button', { name: 'Opciones de User B' }).click();
    const rolePatch = page.waitForResponse((r) => r.url().includes('/members/') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: /^Propietario/ }).click();
    expect((await rolePatch).status()).toBe(200);
    const left = await page.request.delete(`/api/spaces/${spaceId}/members/${userA.id}?force=1`);
    expect(left.status()).toBe(200);
  });

  test('archived space is read-only: no convert, no rename, no lifecycle actions', async ({ page }) => {
    const data = await seedScenario(apiContext, 'space-archived');
    const spaceId = data.coupleId as string;
    await loginAs(page, data.userA as Creds);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('space-header-status')).toHaveText('Pareja · Archivado');
    await expect(page.getByTestId('space-actions')).toHaveCount(0);
    await expect(page.getByTestId('space-action-convert')).toHaveCount(0);
    await expect(page.getByTestId('rename-space')).toHaveCount(0);
    await expect(page.getByText(/código/i)).toHaveCount(0);

    const convert = await page.request.patch(`/api/spaces/${spaceId}`, { data: { type: 'GROUP' } });
    expect(convert.status()).toBe(409);
    const rename = await page.request.patch(`/api/spaces/${spaceId}`, { data: { name: 'Otro' } });
    expect(rename.status()).toBe(409);
  });

  test('"Enviar" reuses the same invite link after a reload; "Generar nuevo" replaces it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const data = await seedScenario(apiContext, 'solo-user');
    await loginAs(page, data.user as Creds);
    const created = await page.request.post('/api/spaces', { data: { type: 'GROUP', name: 'Piso QA' } });
    expect(created.ok()).toBeTruthy();
    const spaceId = (await created.json()).space.id as string;

    await page.goto('/dashboard');
    const card = page.getByTestId('space-invite-card');
    await expect(card).toContainText('Invitar a Piso QA');
    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`) posts++;
    });
    await card.getByRole('button', { name: 'Enviar' }).click();
    const link = card.getByTestId('invite-link');
    await expect(link).toContainText('/i/', { timeout: 20000 });
    const firstLink = await link.textContent();

    await page.reload();
    await expect(page.getByTestId('invite-link')).toHaveText(firstLink!, { timeout: 20000 });
    await page.getByTestId('space-invite-card').getByRole('button', { name: 'Enviar' }).click();
    expect(posts).toBe(1);

    // "Generar nuevo" revokes the old invite (awaited DELETE) and then mints a new
    // one; the link is briefly cleared in between, so wait for the mint itself
    // instead of the first DOM change before counting/listing.
    const revoked = page.waitForResponse((r) =>
      r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`);
    const minted = page.waitForResponse((r) =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`);
    await page.getByRole('button', { name: 'Generar nuevo' }).click();
    expect((await revoked).ok()).toBeTruthy();
    expect((await minted).ok()).toBeTruthy();
    await expect(page.getByTestId('invite-link')).toContainText('/i/');
    await expect(page.getByTestId('invite-link')).not.toHaveText(firstLink!);
    expect(posts).toBe(2);
    const list = await (await page.request.get(`/api/spaces/${spaceId}/invites`)).json();
    const live = list.invites.filter((i: { revokedAt: string | null }) => !i.revokedAt);
    expect(live).toHaveLength(1);

    // The management page shows the same remembered link and no short code.
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('invite-current-link')).toContainText('/i/');
    await expect(page.getByText(/código/i)).toHaveCount(0);
  });

  test('month totals ignore future-dated expenses (Inicio and Espacios)', async ({ page }) => {
    const data = await seedScenario(apiContext, 'solo-user');
    await loginAs(page, data.user as Creds);
    const today = await page.request.post('/api/expenses', {
      data: { description: 'Hoy', amount: '10.00', category: 'other', visibility: 'PERSONAL' },
    });
    expect(today.ok(), await today.text()).toBeTruthy();
    const future = await page.request.post('/api/expenses', {
      data: { description: 'Futuro', amount: '999.00', category: 'other', visibility: 'PERSONAL', date: madridDate(1) },
    });
    expect(future.ok(), await future.text()).toBeTruthy();

    await page.goto('/dashboard?scope=personal');
    await expect(page.getByTestId('month-summary')).toContainText(/10,00\s€/);
    await expect(page.getByTestId('month-summary')).not.toContainText('999');
    await expect(page.getByTestId('space-card-active')).toContainText(/10,00\s€/);
    await page.goto('/spaces');
    await expect(page.getByTestId('space-row').filter({ hasText: 'Personal' })).toContainText(/10,00\s€ este mes/);
  });

  test('trip end date: stored as end of that Madrid day, past dates rejected, truthful copy', async ({ page }) => {
    const data = await seedScenario(apiContext, 'solo-user');
    await loginAs(page, data.user as Creds);

    const past = await page.request.post('/api/spaces', { data: { type: 'EPHEMERAL', name: 'Pasado', expiresAt: '2020-01-01' } });
    expect(past.status()).toBe(400);
    expect((await past.json()).code).toBe('INVALID_END_DATE');

    const end = madridDate(1, 10);
    const ok = await page.request.post('/api/spaces', { data: { type: 'EPHEMERAL', name: 'Lisboa', expiresAt: end } });
    expect(ok.ok()).toBeTruthy();
    const expiresAt = new Date((await ok.json()).space.expiresAt);
    // Last instant of that day in Madrid.
    const madridDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(expiresAt);
    expect(madridDay).toBe(end);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(expiresAt.getTime() + 1))).not.toBe(end);

    await page.goto('/spaces/new');
    await page.getByRole('button', { name: /Un viaje/ }).click();
    const date = page.getByLabel('Último día del viaje (opcional)');
    await expect(date).toHaveAttribute('min', /^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByText('Los invitados sin cuenta podrán entrar hasta el final de ese día.', { exact: false })).toBeVisible();
  });

  test('welcome works with spaces (create mode, back to Inicio)', async ({ page }) => {
    const data = await seedScenario(apiContext, 'couple-with-debt');
    await loginAs(page, data.userA as Creds);
    await page.goto('/welcome');
    await expect(page.getByRole('heading', { name: '¿Con quién compartes gastos?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver' })).toHaveAttribute('href', '/dashboard');
    await expect(page.getByRole('button', { name: /Mi piso/ })).toContainText('🏢');
  });
});
