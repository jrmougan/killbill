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

    // C owes money: the FIRST sheet already shows it, "Saldar deuda" is the main action and
    // "Salir sin saldar" needs the checkbox before the ?force=1 call.
    const ctxC = await createAuthenticatedContext(newContext, userC);
    const pageC = await ctxC.newPage();
    await pageC.goto(`/spaces/${spaceId}`);
    const blocked = await pageC.request.delete(`/api/spaces/${spaceId}/members/${userC.id}`);
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'HAS_BALANCE', balanceCents: -3333 });
    await pageC.getByTestId('leave-space').click();
    const sheet = pageC.getByTestId('leave-sheet');
    await expect(pageC.getByRole('dialog', { name: 'Antes de salir, salda tu deuda' })).toBeVisible();
    await expect(sheet).toContainText(/Debes 33,33\s€/);
    await expect(sheet.getByTestId('confirm-sheet-confirm')).toHaveText('Saldar deuda');
    await sheet.getByRole('button', { name: 'Salir sin saldar' }).click();
    const confirm = sheet.getByTestId('confirm-sheet-confirm');
    await expect(confirm).toBeDisabled();
    await sheet.getByTestId('leave-ack').check();
    const forced = pageC.waitForResponse((r) => r.url().includes(`/members/${userC.id}?force=1`));
    await confirm.click();
    expect((await forced).status()).toBe(200);
    await expect(pageC).toHaveURL(/\/dashboard/);
    await expect(pageC.getByText('Has salido de')).toBeVisible();

    // A is the only OWNER and B remains: LAST_OWNER, not overridable; the sheet leads to Miembros.
    await loginAs(page, userA);
    await page.goto(`/spaces/${spaceId}`);
    await page.getByTestId('leave-space').click();
    await expect(page.getByTestId('leave-sheet')).toContainText('Eres la única persona propietaria');
    const forcedOwner = await page.request.delete(`/api/spaces/${spaceId}/members/${userA.id}?force=1`);
    expect(forcedOwner.status()).toBe(409);
    expect((await forcedOwner.json()).code).toBe('LAST_OWNER');
    await page.getByTestId('leave-sheet').getByRole('button', { name: 'Elegir persona propietaria' }).click();

    // "Elegir persona propietaria" opened B's member sheet → make B owner, then A may leave (A is owed money: force).
    const rolePatch = page.waitForResponse((r) => r.url().includes('/members/') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: /^Propietario/ }).click();
    await expect(page.getByTestId('owner-confirm')).toContainText('User B podrá cambiar roles');
    await page.getByRole('button', { name: 'Hacer propietaria a User B' }).click();
    expect((await rolePatch).status()).toBe(200);
    await expect(page.getByText('User B ahora es propietario')).toBeVisible();
    const left = await page.request.delete(`/api/spaces/${spaceId}/members/${userA.id}?force=1`);
    expect(left.status()).toBe(200);
  });

  test('removing a member: danger sheet before the DELETE; an open balance shows the debt instead', async ({ page }) => {
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    const spaceId = data.coupleId as string;
    const userB = data.userB as Creds;
    await loginAs(page, data.userA as Creds); // OWNER, B at 0
    await page.goto(`/spaces/${spaceId}`);

    let deletes = 0;
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().includes(`/members/${userB.id}`)) deletes++;
    });
    await page.getByRole('button', { name: 'Opciones de User B' }).click();
    await page.getByTestId('member-remove').click();
    const sheet = page.getByTestId('remove-sheet');
    await expect(sheet).toContainText('Para volver necesitará un enlace nuevo.');
    await expect(page.getByTestId('confirm-sheet-cancel')).toBeFocused();
    await page.getByTestId('confirm-sheet-cancel').click();
    await expect(sheet).toHaveCount(0);
    expect(deletes).toBe(0);

    await page.getByRole('button', { name: 'Opciones de User B' }).click();
    await page.getByTestId('member-remove').click();
    const removed = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/members/${userB.id}`));
    await page.getByTestId('remove-sheet').getByTestId('confirm-sheet-confirm').click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByText(/User B ya no está en/)).toBeVisible();
    await expect(page.getByTestId('member-row')).toHaveCount(1);
  });

  test('a member who owes: the sheet shows the debt and the reminder, not the red button', async ({ page }) => {
    const data = await seedScenario(apiContext, 'group-of-3');
    const spaceId = data.coupleId as string;
    await loginAs(page, data.userA as Creds); // OWNER, C owes 33,33 € (to A)
    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole('button', { name: 'Opciones de User C' }).click();
    const block = page.getByTestId('member-balance-block');
    await expect(block).toContainText(/User C debe 33,33\s€ en este espacio/);
    await expect(block.getByRole('button', { name: 'Recordarle la deuda a User C' })).toBeVisible();
    await expect(page.getByTestId('member-remove')).toHaveCount(0);
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

    // "Generar nuevo" asks first (nothing is sent until the sheet is confirmed),
    // then revokes the old invite (awaited DELETE) and mints a new one; the link
    // is briefly cleared in between, so wait for the mint itself instead of the
    // first DOM change before counting/listing.
    let deletes = 0;
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`) deletes++;
    });
    await page.getByRole('button', { name: 'Generar nuevo' }).click();
    await expect(page.getByRole('dialog', { name: '¿Crear un enlace nuevo?' })).toContainText('El enlace que ya enviaste dejará de funcionar');
    expect(deletes).toBe(0);
    const revoked = page.waitForResponse((r) =>
      r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`);
    const minted = page.waitForResponse((r) =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`);
    await page.getByTestId('regenerate-sheet').getByTestId('confirm-sheet-confirm').click();
    expect((await revoked).ok()).toBeTruthy();
    expect((await minted).ok()).toBeTruthy();
    await expect(page.getByTestId('invite-link')).toContainText('/i/');
    await expect(page.getByTestId('invite-link')).not.toHaveText(firstLink!);
    expect(posts).toBe(2);
    const list = await (await page.request.get(`/api/spaces/${spaceId}/invites`)).json();
    const live = list.invites.filter((i: { revokedAt: string | null }) => !i.revokedAt);
    expect(live).toHaveLength(1);
    await expect(page.getByText('Enlace nuevo listo. El anterior ya no funciona.')).toBeVisible();

    // The management page shows the same remembered link and no short code.
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('invite-current-link')).toContainText('/i/');
    await expect(page.getByText(/código/i)).toHaveCount(0);

    // Deactivating a link asks first (danger sheet, focus on Cancelar).
    const liveRow = page.locator('[data-testid="invite-row"][data-live="true"]');
    await expect(liveRow).toHaveCount(1);
    await expect(liveRow).toContainText('Creado hoy');
    await liveRow.getByRole('button', { name: /^Desactivar enlace/ }).click();
    const revokeSheet = page.getByTestId('revoke-sheet');
    await expect(revokeSheet).toContainText('Las personas que ya entraron siguen en el espacio.');
    await expect(page.getByTestId('confirm-sheet-cancel')).toBeFocused();
    const deactivated = page.waitForResponse((r) =>
      r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/api/spaces/${spaceId}/invites`);
    await revokeSheet.getByTestId('confirm-sheet-confirm').click();
    expect((await deactivated).ok()).toBeTruthy();
    await expect(page.getByText('Enlace desactivado')).toBeVisible();
    await expect(liveRow).toHaveCount(0);
    await expect(page.getByTestId('invite-current-link')).toHaveCount(0);
  });

  test('a full couple offers "Convertir en grupo" next to Invitaciones; joining greets with "Ya estás en…"', async ({ page }) => {
    const data = await seedScenario(apiContext, 'couple-no-expenses');
    const spaceId = data.coupleId as string;

    // A member is told who can convert it.
    await loginAs(page, data.userB as Creds);
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByText(/La pareja está completa\. Solo User puede convertirla en grupo/)).toBeVisible();
    await expect(page.getByTestId('invite-convert')).toHaveCount(0);

    await page.context().clearCookies();
    await loginAs(page, data.userA as Creds); // OWNER
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.getByTestId('invite-reason')).toContainText('La pareja está completa');
    let patches = 0;
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname === `/api/spaces/${spaceId}`) patches++;
    });
    await page.getByTestId('invite-convert').click();
    const sheet = page.getByTestId('convert-sheet');
    await expect(sheet).toContainText('No se puede volver a pareja.');
    expect(patches).toBe(0);
    await sheet.getByTestId('confirm-sheet-confirm').click();
    await expect(page.getByText('Test Couple ya es un grupo')).toBeVisible();
    await expect(page.getByTestId('space-header-status')).toHaveText('Grupo · Activo');
    await expect(page.getByRole('button', { name: 'Crear enlace de invitación' })).toBeVisible();

    // A third person joins through a link and lands on Inicio with a welcome toast.
    const minted = await page.request.post(`/api/spaces/${spaceId}/invites`, { data: { kind: 'MEMBER', maxUses: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    expect(minted.ok(), await minted.text()).toBeTruthy();
    const token = (await minted.json()).token as string;
    const solo = await seedScenario(apiContext, 'solo-user');
    await page.context().clearCookies();
    await loginAs(page, solo.user as Creds);
    await page.goto(`/i/${token}`);
    await page.getByTestId('invite-join').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Ya estás en Test Couple')).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Ahora no' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Mi piso/ })).toContainText('🏢');
  });
});
