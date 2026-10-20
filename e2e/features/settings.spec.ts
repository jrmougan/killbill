import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Ajustes', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('Hermes: confirm before issuing; the token sheet only closes explicitly', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/settings');

    let issued = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/me/mcp-token') && r.method() === 'POST') issued += 1; });

    await page.getByRole('button', { name: 'Conectar' }).click();
    const confirm = page.getByRole('dialog', { name: 'Conectar Hermes Agent' });
    await expect(confirm).toContainText('90 días');
    // MCP tokens are revocable via User.tokenVersion ("cerrar sesión en todos los dispositivos").
    await expect(confirm).toContainText('Cerrar sesión en todos los dispositivos');
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
    await expect(tokenSheet).toContainText('Generar otro no desactiva este');
    // Not copied yet: closing asks first ("Volver" keeps the token on screen).
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await tokenSheet.getByRole('button', { name: 'Volver' }).click();
    await expect(tokenSheet.getByTestId('mcp-close-unsaved')).toHaveCount(0);
    await tokenSheet.getByRole('button', { name: 'He guardado el token' }).click();
    await tokenSheet.getByRole('button', { name: 'Cerrar sin copiar' }).click();
    await expect(tokenSheet).toHaveCount(0);
  });

  test('cerrar sesión en todos los dispositivos: hoja danger, vuelve al login con aviso y el token MCP deja de valer', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    const issued = await page.request.post('/api/me/mcp-token');
    expect(issued.ok()).toBe(true);
    const { token } = await issued.json();
    await page.goto('/settings');

    const account = page.getByRole('region', { name: 'Cuenta' });
    await account.getByRole('button', { name: /^Cerrar sesión en todos los dispositivos/ }).click();
    const sheet = page.getByRole('alertdialog', { name: '¿Cerrar sesión en todos los dispositivos?' });
    await expect(sheet).toContainText('Hermes Agent');
    await expect(sheet.getByTestId('confirm-sheet-confirm')).toHaveText('Cerrar todas las sesiones');
    await sheet.getByTestId('confirm-sheet-confirm').click();

    await expect(page).toHaveURL(/\/login\?signedOut=all/);
    await expect(page.getByRole('status')).toContainText('todos tus dispositivos');
    const mcp = await request.post('/api/mcp', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status()).toBe(401);
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
