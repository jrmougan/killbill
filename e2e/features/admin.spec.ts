import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

test.describe('Administración', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('anular una invitación pide confirmación y la quita de Disponibles', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    const code = seed.inviteCode!;
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });
    await page.goto('/admin');

    const available = page.getByRole('region', { name: 'Disponibles' });
    await expect(available).toContainText(code);
    await expect(available.getByRole('button', { name: `Copiar enlace de registro ${code}` })).toHaveText('Copiar enlace');

    await page.getByRole('button', { name: `Anular invitación ${code}` }).click();
    const sheet = page.getByRole('alertdialog', { name: `¿Anular la invitación ${code}?` });
    await expect(sheet).toContainText('El enlace de registro que hayas enviado dejará de funcionar');
    await sheet.getByRole('button', { name: 'Cancelar' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(available).toContainText(code);

    await page.getByRole('button', { name: `Anular invitación ${code}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Anular invitación' }).click();
    await expect(page.getByText('Invitación anulada')).toBeVisible();
    await expect(available).toContainText('No hay invitaciones libres');
    await expect(page.getByText(code)).toHaveCount(0);
  });

  test('crear una invitación la añade a Disponibles y sube el contador', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });
    await page.goto('/admin');

    const count = page.getByTestId('admin-available-count');
    const rows = page.getByRole('region', { name: 'Disponibles' }).getByRole('listitem');
    await expect(count).toHaveText('1');
    await expect(rows).toHaveCount(1);

    await page.getByRole('button', { name: 'Nueva invitación' }).click();
    await expect(page.getByText('Invitación creada')).toBeVisible();
    await expect(count).toHaveText('2');
    await expect(rows).toHaveCount(2);
    // The new one is listed first and, unlike the seeded one, expires in 7 days.
    await expect(rows.first()).toContainText(/[0-9A-F]{8}/);
    await expect(rows.first()).toContainText('Caduca el ');
  });

  test('el enlace copiado abre el registro con el código de la administración y crea la cuenta', async ({ page, context, request, newContext }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });
    await page.goto('/admin');

    // The seeded code is 6 characters; the panel creates the real 8-character ones.
    await page.getByRole('button', { name: 'Nueva invitación' }).click();
    await expect(page.getByTestId('admin-available-count')).toHaveText('2');
    const row = page.getByRole('region', { name: 'Disponibles' }).getByRole('listitem').first();
    await row.getByRole('button', { name: /^Copiar enlace de registro/ }).click();
    await expect(page.getByText('Enlace de registro copiado')).toBeVisible();
    await expect(page.getByText('No se pudo copiar el enlace')).toHaveCount(0);

    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/register\?code=[0-9A-F]{8}$/);
    const code = new URL(link).searchParams.get('code')!;
    await expect(row).toContainText(code);

    // Whoever receives the link is not signed in.
    const visitor = await (await newContext()).newPage();
    await visitor.goto(new URL(link).pathname + new URL(link).search);
    await expect(visitor.getByText('EQUIL funciona por invitación')).toBeVisible();
    await expect(visitor.getByText('Te han invitado a compartir gastos')).toHaveCount(0);
    await expect(visitor.getByTestId('register-invite-code')).toHaveValue(code);
    // An admin code joins no space, so it must not follow the visitor to the login.
    await expect(visitor.getByRole('link', { name: 'Inicia sesión' })).toHaveAttribute('href', '/login');

    await visitor.getByTestId('register-name').fill('Invitada');
    await visitor.getByTestId('register-email').fill(`invitada_${Date.now()}@test.com`);
    await visitor.getByTestId('register-password').fill('Password123');
    await visitor.getByTestId('register-submit').click();
    await expect(visitor).toHaveURL(/\/welcome/, { timeout: 10000 });

    await page.reload();
    await expect(page.getByRole('region', { name: 'Usadas' })).toContainText('Invitada');
    await expect(page.getByRole('region', { name: 'Usadas' })).toContainText(code);
  });

  test('una invitación ya anulada en otra pestaña no deja la hoja en un bucle de reintentos', async ({ page, context, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    const code = seed.inviteCode!;
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });
    await page.goto('/admin');
    const other = await context.newPage();
    await other.goto('/admin');

    await page.getByRole('button', { name: `Anular invitación ${code}` }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    await other.getByRole('button', { name: `Anular invitación ${code}` }).click();
    await other.getByRole('alertdialog').getByRole('button', { name: 'Anular invitación' }).click();
    await expect(other.getByText('Invitación anulada')).toBeVisible();

    await page.getByRole('alertdialog').getByRole('button', { name: 'Anular invitación' }).click();
    await expect(page.getByText('Esta invitación ya se había usado o anulado')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(code)).toHaveCount(0);
  });

  test('navegación entre Ajustes, Administración e IA de los tickets', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });

    await page.goto('/settings');
    await page.getByRole('link', { name: 'Administración' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();

    await page.getByRole('link', { name: /IA de los tickets/ }).click();
    await expect(page).toHaveURL(/\/admin\/ai$/);
    await expect(page.getByRole('heading', { name: 'IA de los tickets' })).toBeVisible();

    await page.getByRole('link', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('button', { name: 'Nueva invitación' })).toBeVisible();
  });

  test('quien no es admin ve "Solo administración" y no tiene la entrada en Ajustes', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-with-debt');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password });

    for (const path of ['/admin', '/admin/ai']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Solo administración' })).toBeVisible();
      await expect(page.getByText('No tienes permisos de administrador para ver esta página.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva invitación' })).toHaveCount(0);
      await expect(page.getByLabel('Clave de API')).toHaveCount(0);
    }
    await page.getByRole('link', { name: 'Ir a Inicio' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administración' })).toHaveCount(0);
  });
});
