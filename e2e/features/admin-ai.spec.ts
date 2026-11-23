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
    await gemini.getByLabel('Modelo', { exact: true }).fill('gemini-e2e-model');
    await gemini.getByRole('button', { name: 'Guardar', exact: true }).click();

    await expect(gemini.getByText('••••Q7rT')).toBeVisible();
    await expect(key).toHaveValue('');

    // A fresh server render shows the stored state and never carries the plaintext.
    const res = await page.goto('/admin/ai');
    expect(await res!.text()).not.toContain(PLAINTEXT_KEY);
    await expect(gemini.getByText('••••Q7rT')).toBeVisible();
    await expect(gemini.getByLabel('Modelo', { exact: true })).toHaveValue('gemini-e2e-model');
  });

  // The lists come from the loopback provider stub (e2e/ocr/provider-stub.mjs).
  test('un admin elige un modelo con visión de la lista del proveedor', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });

    await page.goto('/admin/ai');
    const gemini = page.getByRole('region', { name: /gemini/i });
    const model = gemini.getByLabel('Modelo', { exact: true });
    await expect(gemini.getByRole('listbox')).toHaveCount(0);

    await model.click();
    const list = gemini.getByRole('listbox', { name: 'Modelos con visión' });
    await expect(list.getByRole('option', { name: /Gemini Flash Latest/ })).toContainText('(actual)');
    await expect(list.getByRole('option', { name: /Gemini E2E Flash/ })).toBeVisible();
    // Models that cannot read an image are not offered.
    await expect(list.getByRole('option', { name: /Embedding|TTS|Image|Gemma/ })).toHaveCount(0);

    await model.fill('pro');
    await expect(list.getByRole('option')).toHaveCount(1);
    await list.getByRole('option', { name: /Gemini E2E Pro/ }).click();
    await expect(model).toHaveValue('gemini-e2e-pro');
    await gemini.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(gemini.getByText('En uso: gemini-e2e-pro (guardado aquí)')).toBeVisible();

    const openrouter = page.getByRole('region', { name: /openrouter/i });
    await openrouter.getByRole('button', { name: 'Ver modelos' }).click();
    const routerList = openrouter.getByRole('listbox', { name: 'Modelos con visión' });
    await expect(routerList.getByRole('option', { name: /E2E: Vision Flash/ })).toBeVisible();
    await expect(routerList.getByRole('option', { name: /Text Only|Image Maker|No Schema|batch|Alias/ })).toHaveCount(0);
  });

  test('cabe en un móvil de 320 px sin scroll horizontal', async ({ page, request }) => {
    const seed = await seedScenario(request, 'admin-with-invite');
    await loginAs(page, { email: seed.admin!.email, password: seed.admin!.password! });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/admin/ai');
    await expect(page.getByLabel('Clave de API').first()).toBeVisible();
    // With both model lists open too.
    // The toggle of a card is hidden while its list loads, so `first()` is the next closed one.
    await page.getByRole('button', { name: 'Ver modelos' }).first().click();
    await expect(page.getByRole('listbox')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ver modelos' }).first().click();
    await expect(page.getByRole('listbox')).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
