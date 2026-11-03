import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// Never a real credential.
const PLAINTEXT_KEY = 'e2e-admin-ai-plaintext-Q7rT';

test.describe('Admin - Claves y modelos de IA', () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
  });

  test.afterEach(async ({ request }) => {
    await resetDb(request);
  });

  test('un admin guarda una clave y un modelo sin que la clave vuelva al navegador', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });

    await page.goto('/admin/ai');
    const gemini = page.getByRole('region', { name: /gemini/i });
    const key = gemini.getByLabel('Clave de API');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('type', 'password');

    await key.fill(PLAINTEXT_KEY);
    await gemini.getByLabel('Modelo').fill('gemini-e2e-model');
    await gemini.getByRole('button', { name: 'Guardar', exact: true }).click();

    await expect(gemini.getByText('••••Q7rT')).toBeVisible();
    await expect(key).toHaveValue('');

    // A fresh server render shows the stored state and never carries the plaintext.
    const res = await page.goto('/admin/ai');
    expect(await res!.text()).not.toContain(PLAINTEXT_KEY);
    await expect(gemini.getByText('••••Q7rT')).toBeVisible();
    await expect(gemini.getByLabel('Modelo')).toHaveValue('gemini-e2e-model');
  });

  test('cabe en un móvil de 320 px sin scroll horizontal', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/admin/ai');
    await expect(page.getByLabel('Clave de API').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
