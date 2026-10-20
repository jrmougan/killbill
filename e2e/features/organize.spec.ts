import { test, expect } from '../fixtures/test.fixture';
import { resetDb, seedScenario } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// CF-24: deleting a tag or a category goes through a danger sheet that names it.
test.describe('Organizar · eliminar etiquetas y categorías', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('a tag is deleted from its sheet, with a toast', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-no-expenses');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/tags');
    await page.getByLabel('Nombre de la etiqueta').fill('Viaje QA');
    await page.getByRole('button', { name: 'Crear etiqueta' }).click();
    await page.getByRole('button', { name: 'Eliminar etiqueta Viaje QA', exact: true }).click();

    const sheet = page.getByRole('alertdialog', { name: '¿Eliminar la etiqueta «Viaje QA»?' });
    await expect(sheet).toContainText('Se quitará de todos los gastos del espacio');
    await sheet.getByRole('button', { name: 'Eliminar etiqueta', exact: true }).click();
    await expect(page.getByText('Etiqueta «Viaje QA» eliminada')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminar etiqueta Viaje QA', exact: true })).toHaveCount(0);
  });

  test('a category is deleted moving its spend to the chosen target', async ({ page, request }) => {
    const seed = await seedScenario(request, 'couple-no-expenses');
    await loginAs(page, { email: seed.userA!.email, password: seed.userA!.password! });
    await page.goto('/categories');
    await page.getByRole('button', { name: 'Nueva categoría', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Mascotas QA');
    await page.getByRole('button', { name: 'Crear categoría', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar Mascotas QA', exact: true }).click();

    const sheet = page.getByRole('alertdialog', { name: '¿Eliminar la categoría «Mascotas QA»?' });
    await expect(sheet).toContainText('pasarán a la categoría que elijas');
    await sheet.getByRole('button', { name: 'Eliminar y mover a «Otro»' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Mascotas QA', { exact: true })).toHaveCount(0);
  });
});
