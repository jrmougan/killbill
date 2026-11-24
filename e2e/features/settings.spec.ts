import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Ajustes', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('Hermes: confirm before issuing; the token sheet only closes explicitly; it is a listed, revocable access token', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/settings');

    let issued = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/me/mcp-token') && r.method() === 'POST') issued += 1; });

    await page.getByRole('button', { name: 'Conectar' }).click();
    const confirm = page.getByRole('dialog', { name: 'Conectar Hermes Agent' });
    await expect(confirm).toContainText('90 días');
    // The Hermes token is an access token: revoked on its own from "Tokens de acceso".
    await expect(confirm).toContainText('Tokens de acceso');
    await expect(confirm).toContainText('Si ya tenías un token «Hermes Agent», se revocará');
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toHaveCount(0);
    expect(issued).toBe(0);

    await page.getByRole('button', { name: 'Conectar' }).click();
    await page.getByRole('button', { name: 'Generar token' }).click();
    const tokenSheet = page.getByRole('dialog', { name: 'Guarda tu token ahora' });
    await expect(tokenSheet).toBeVisible();
    expect(issued).toBe(1);
    // Escape and a backdrop tap do not lose the one-time token.
    await page.keyboard.press('Escape');
    await expect(tokenSheet).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(tokenSheet).toBeVisible();
    await expect(tokenSheet.getByRole('button', { name: 'Cerrar', exact: true })).toHaveCount(0);
    await expect(tokenSheet).toContainText('Generar otro lo revoca');
    const firstToken = (await tokenSheet.locator('code').textContent())?.trim() ?? '';
    expect(firstToken).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    await expect(tokenSheet.locator('pre')).toContainText(`Bearer ${firstToken}`);
    await expect(tokenSheet.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' })).toHaveCount(0);
    // Not copied yet: closing asks first ("Volver" keeps the token on screen).
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await tokenSheet.getByRole('button', { name: 'Volver' }).click();
    await expect(tokenSheet.getByTestId('mcp-close-unsaved')).toHaveCount(0);
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await tokenSheet.getByRole('button', { name: 'Cerrar sin copiar' }).click();
    await expect(tokenSheet).toHaveCount(0);

    // It is listed in "Tokens de acceso" as «Hermes Agent», active, 90 days.
    const connections = page.getByRole('region', { name: 'Conexiones' });
    const summary = connections.getByTestId('access-tokens-summary');
    await expect(summary).toHaveText('1 activo');
    await connections.getByRole('button', { name: /Tokens de acceso/ }).click();
    const list = page.getByRole('dialog', { name: 'Tokens de acceso' });
    const hermesRows = list.getByTestId('access-token-row').filter({ hasText: 'Hermes Agent' });
    await expect(hermesRows).toHaveCount(1);
    await expect(hermesRows.first()).toHaveAttribute('data-status', 'active');
    await expect(hermesRows.first()).toContainText(firstToken.slice(0, 11));
    await expect(hermesRows.first()).toContainText('Caduca el');
    await list.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(list).toHaveCount(0);

    // Reconnecting replaces it: the old one is revoked, still exactly one active.
    await connections.getByRole('button', { name: 'Nuevo token' }).click();
    const again = page.getByRole('dialog', { name: '¿Generar otro token?' });
    await again.getByRole('button', { name: 'Generar token' }).click();
    await expect(tokenSheet).toBeVisible();
    expect(issued).toBe(2);
    const secondToken = (await tokenSheet.locator('code').textContent())?.trim() ?? '';
    expect(secondToken).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(firstToken);
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await tokenSheet.getByRole('button', { name: 'Cerrar sin copiar' }).click();
    await expect(summary).toHaveText('1 activo');
    await connections.getByRole('button', { name: /Tokens de acceso/ }).click();
    await expect(hermesRows).toHaveCount(2);
    await expect(hermesRows.filter({ hasText: secondToken.slice(0, 11) })).toHaveAttribute('data-status', 'active');
    await expect(hermesRows.filter({ hasText: firstToken.slice(0, 11) })).toHaveAttribute('data-status', 'revoked');

    // Revoked individually from the list, like any other token.
    await hermesRows.filter({ hasText: secondToken.slice(0, 11) }).getByRole('button', { name: 'Revocar Hermes Agent' }).click();
    await page.getByRole('dialog', { name: '¿Revocar «Hermes Agent»?' }).getByRole('button', { name: 'Revocar', exact: true }).click();
    await expect(hermesRows.filter({ hasText: secondToken.slice(0, 11) })).toHaveAttribute('data-status', 'revoked');
    await expect(summary).toHaveText('Conecta un agente o cliente MCP');
    const mcp = await request.post('/api/mcp', {
      headers: { Authorization: `Bearer ${secondToken}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status()).toBe(401);
  });

  test('Tokens de acceso: create a never-expiring token, show it once (not dismissible), list it and revoke it', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/settings');

    let issued = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/me/tokens') && r.method() === 'POST') issued += 1; });

    // The row lives in "Conexiones", under the untouched Hermes Agent row.
    const connections = page.getByRole('region', { name: 'Conexiones' });
    await expect(connections.getByRole('button', { name: 'Conectar', exact: true })).toBeVisible();
    const summary = connections.getByTestId('access-tokens-summary');
    await expect(summary).toHaveText('Conecta un agente o cliente MCP');
    await connections.getByRole('button', { name: /Tokens de acceso/ }).click();
    const list = page.getByRole('dialog', { name: 'Tokens de acceso' });
    await expect(list).toContainText('Aún no has creado ningún token');
    await list.getByRole('button', { name: 'Nuevo token' }).click();

    const create = page.getByRole('dialog', { name: 'Nuevo token' });
    await expect(create.getByRole('radio', { name: '90 días' })).toBeChecked();
    await expect(create.getByTestId('token-no-expiry-warning')).toHaveCount(0);
    await create.getByLabel('Nombre').fill('Agente e2e');
    await create.locator('label', { hasText: 'Sin caducidad' }).click();
    await expect(create.getByRole('radio', { name: 'Sin caducidad' })).toBeChecked();
    await expect(create.getByTestId('token-no-expiry-warning')).toContainText('No caducará nunca');
    expect(issued).toBe(0);
    await create.getByRole('button', { name: 'Generar token' }).click();

    const tokenSheet = page.getByRole('dialog', { name: 'Guarda tu token ahora' });
    await expect(tokenSheet).toBeVisible();
    expect(issued).toBe(1);
    await expect(tokenSheet.getByTestId('access-token-value')).toHaveText(/^kb_[A-Za-z0-9_-]{43}$/);
    await expect(tokenSheet).toContainText('No caduca.');
    await expect(tokenSheet.getByTestId('access-token-config')).toContainText('/api/mcp');
    await expect(tokenSheet.getByRole('button', { name: 'Copiar token' })).toBeVisible();
    // Escape and a backdrop tap do not lose the one-time token.
    await page.keyboard.press('Escape');
    await expect(tokenSheet).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(tokenSheet).toBeVisible();
    await expect(tokenSheet.getByRole('button', { name: 'Cerrar', exact: true })).toHaveCount(0);
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await expect(tokenSheet).toHaveCount(0);

    // Back on the list: the token is active, never expires, and the plaintext is gone.
    await expect(list).toBeVisible();
    const row = list.getByTestId('access-token-row').filter({ hasText: 'Agente e2e' });
    await expect(row).toHaveAttribute('data-status', 'active');
    await expect(row).toContainText('Sin caducidad');
    await expect(row).toContainText('Sin usar');
    await expect(list.getByText(/^kb_[A-Za-z0-9_-]{43}$/)).toHaveCount(0);
    await expect(summary).toHaveText('1 activo');

    // A second token (default 90 days) must survive the revocation of the first.
    await list.getByRole('button', { name: 'Nuevo token' }).click();
    await create.getByLabel('Nombre').fill('Otro agente');
    await create.getByRole('button', { name: 'Generar token' }).click();
    await expect(tokenSheet).toContainText('Caduca el');
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    const other = list.getByTestId('access-token-row').filter({ hasText: 'Otro agente' });
    await expect(other).toHaveAttribute('data-status', 'active');
    await expect(other).toContainText('Caduca el');
    await expect(summary).toHaveText('2 activos');

    // Revoke with confirmation (Cancelar first leaves it active).
    await row.getByRole('button', { name: 'Revocar Agente e2e' }).click();
    const confirm = page.getByRole('dialog', { name: '¿Revocar «Agente e2e»?' });
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(row).toHaveAttribute('data-status', 'active');
    await row.getByRole('button', { name: 'Revocar Agente e2e' }).click();
    await confirm.getByRole('button', { name: 'Revocar', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(row).toHaveAttribute('data-status', 'revoked');
    await expect(row).toContainText('Revocado');
    await expect(row.getByRole('button', { name: /Revocar/ })).toHaveCount(0);
    await expect(other).toHaveAttribute('data-status', 'active');
    await expect(summary).toHaveText('1 activo');
  });

  test('cerrar sesión en todos los dispositivos: hoja danger, vuelve al login con aviso y los tokens MCP dejan de valer', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    const issued = await page.request.post('/api/me/mcp-token');
    expect(issued.ok()).toBe(true);
    const { token: hermes } = await issued.json();
    // A legacy 90-day JWT issued before #60 (no longer emitted by the app).
    const legacy = await page.request.post('/api/test/legacy-mcp-jwt');
    expect(legacy.status()).toBe(201);
    const { token } = await legacy.json();
    const created = await page.request.post('/api/me/tokens', { data: { name: 'Agente', expiresInDays: null } });
    expect(created.status()).toBe(201);
    const { token: opaque } = await created.json();
    await page.goto('/settings');

    const account = page.getByRole('region', { name: 'Cuenta' });
    await account.getByRole('button', { name: /^Cerrar sesión en todos los dispositivos/ }).click();
    const sheet = page.getByRole('alertdialog', { name: '¿Cerrar sesión en todos los dispositivos?' });
    await expect(sheet).toContainText('Hermes Agent');
    await expect(sheet).toContainText('tokens de acceso');
    await expect(sheet.getByTestId('confirm-sheet-confirm')).toHaveText('Cerrar todas las sesiones');
    await sheet.getByTestId('confirm-sheet-confirm').click();

    await expect(page).toHaveURL(/\/login\?signedOut=all/);
    await expect(page.getByRole('status')).toContainText('todos tus dispositivos');
    await expect(page.getByRole('status')).toContainText('también el de Hermes Agent');
    const mcpHermes = await request.post('/api/mcp', {
      headers: { Authorization: `Bearer ${hermes}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcpHermes.status()).toBe(401);
    const mcp = await request.post('/api/mcp', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status()).toBe(401);
    // The opaque access token (even one without expiry) is revoked in the same action.
    const mcpOpaque = await request.post('/api/mcp', {
      headers: { Authorization: `Bearer ${opaque}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcpOpaque.status()).toBe(401);
  });

  test('cerrar sesión lleva al login con aviso', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/settings');
    await page.getByRole('region', { name: 'Cuenta' }).getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1/);
    await expect(page.getByRole('status')).toHaveText('Has cerrado la sesión.');
  });

  test('only profile, tools and account: spaces (leave/join) live in Espacios', async ({ page, request }) => {
    const seed = await seedScenario(request, 'group-of-3');
    await loginAs(page, seed.userC as { email: string; password: string });
    await page.goto('/settings');

    await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible();
    for (const name of ['Organizar', 'Conexiones', 'Cuenta']) {
      await expect(page.getByRole('region', { name })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Espacios' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Salir de / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unirme con un enlace' })).toHaveCount(0);
  });

  test('personal mode is kept by the back arrow and Presupuestos; personal CSV export works without a space', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/dashboard?scope=personal');
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: 'Presupuestos' })).toHaveAttribute('href', /scope=personal/);
    await expect(page.getByRole('link', { name: /Volver|Atrás/ }).first()).toHaveAttribute('href', '/dashboard?scope=personal');

    const solo = await seedScenario(request, 'solo-user');
    const res = await page.request.post('/api/expenses', {
      data: { description: 'Libro QA', amount: 12.5, category: 'other', isPersonal: true },
    });
    expect(res.ok()).toBe(true);
    const csv = await page.request.get('/api/export?scope=personal');
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain('Libro QA');
    // A user without any space still sees the export row.
    await page.context().clearCookies();
    await loginAs(page, { email: solo.user!.email, password: solo.user!.password! });
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: 'Exportar gastos (CSV)' })).toHaveAttribute('href', '/api/export?scope=personal');
  });
});
