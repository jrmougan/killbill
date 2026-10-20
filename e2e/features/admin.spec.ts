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
});
