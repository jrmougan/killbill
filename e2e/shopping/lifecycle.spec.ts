import { test, expect } from '../fixtures/test.fixture';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

type Creds = { email: string; password: string; id: string };

/**
 * Lists × space lifecycle, quantities, duplicates and back-navigation.
 * Product rule: a list is PLANNING (never an expense), so it stays editable
 * while the space is SETTLING; only ARCHIVED makes Común lists read-only.
 */
test.describe('Shopping lists — lifecycle, quantities and duplicates', () => {
  test.beforeEach(async ({ request }) => { await resetDb(request); });
  test.afterEach(async ({ request }) => { await resetDb(request); });

  test('SETTLING space: lists stay editable and the shortcut only empties the cart', async ({ page, request }) => {
    const data = await seedScenario(request, 'lists-prefilled');
    const userA = data.userA as Creds;
    const groupListId = data.groupListId as string;
    const coupleId = data.coupleId as string;
    await loginAs(page, userA);
    const settle = await page.request.post(`/api/spaces/${coupleId}/settle-up`);
    expect(settle.ok(), await settle.text()).toBe(true);

    await page.goto(`/lists/${groupListId}`);
    await expect(page.getByTestId('list-readonly-banner')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Leche' }).check();
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toBeChecked();
    const addInput = page.getByRole('textbox', { name: 'Añadir producto' });
    await addInput.fill('Huevos');
    await addInput.press('Enter');
    await expect(page.getByRole('checkbox', { name: 'Huevos' })).toBeVisible();

    // No new expenses while settling: "Terminar compra" just clears the cart.
    await page.getByRole('button', { name: 'Terminar compra' }).click();
    const toast = page.getByText(/Carro vaciado\. El espacio se está liquidando/);
    await expect(toast).toBeVisible();
    await expect(page).toHaveURL(`/lists/${groupListId}`);
    // The toast wraps inside the viewport (no horizontal overflow).
    const box = await toast.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
    await expect(page.getByText(/En el carro/)).toHaveCount(0);
  });

  test('ARCHIVED space: Común list is read-only in the UI and the API answers 409', async ({ page, request }) => {
    const data = await seedScenario(request, 'lists-prefilled');
    const userA = data.userA as Creds;
    const groupListId = data.groupListId as string;
    const coupleId = data.coupleId as string;
    await loginAs(page, userA);
    const archive = await page.request.patch(`/api/spaces/${coupleId}`, { data: { status: 'ARCHIVED' } });
    expect(archive.ok(), await archive.text()).toBe(true);

    await page.goto(`/lists/${groupListId}`);
    await expect(page.getByTestId('list-readonly-banner')).toContainText('solo lectura');
    await expect(page.getByRole('textbox', { name: 'Añadir producto' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Terminar/ })).toHaveCount(0);

    const add = await page.request.post(`/api/spaces/${coupleId}/lists/${groupListId}/items`, { data: { name: 'Huevos' } });
    expect(add.status()).toBe(409);
    expect((await add.json()).code).toBe('SPACE_NOT_WRITABLE');

    // A new list can only be personal.
    await page.getByRole('button', { name: '+ Nueva' }).click();
    const sheet = page.getByRole('dialog', { name: 'Nueva lista' });
    await expect(sheet.getByRole('radio', { name: 'Común' })).toBeDisabled();
    await expect(sheet.getByRole('radio', { name: 'Personal' })).toBeChecked();
  });

  test('item quantity accepts decimals and rejects garbage with an inline error', async ({ page, request }) => {
    const data = await seedScenario(request, 'lists-prefilled');
    await loginAs(page, data.userA as Creds);
    await page.goto(`/lists/${data.groupListId}`);

    await page.getByRole('button', { name: 'Editar Pan' }).click();
    const sheet = page.getByRole('dialog', { name: 'Editar producto' });
    await sheet.getByLabel('Cantidad').fill('abc');
    await sheet.getByRole('button', { name: 'Guardar' }).click();
    await expect(sheet.getByRole('alert')).toHaveText(/número mayor que 0/);
    await expect(sheet).toBeVisible();

    await sheet.getByLabel('Cantidad').fill('1,5');
    await sheet.getByLabel('Unidad').fill('kg');
    await sheet.getByRole('button', { name: 'Guardar' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar Pan' })).toContainText('1,5 kg');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Editar Pan' })).toContainText('1,5 kg');
  });

  test('adding a duplicate asks first and can bump the quantity instead', async ({ page, request }) => {
    const data = await seedScenario(request, 'lists-prefilled');
    await loginAs(page, data.userA as Creds);
    await page.goto(`/lists/${data.groupListId}`);

    const addInput = page.getByRole('textbox', { name: 'Añadir producto' });
    await addInput.fill('leche');
    await addInput.press('Enter');
    const warning = page.getByTestId('duplicate-warning');
    await expect(warning).toContainText('ya está en la lista');
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toHaveCount(1);

    await warning.getByRole('button', { name: 'Sumar 1' }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toHaveCount(1);

    await addInput.fill('Leche');
    await addInput.press('Enter');
    await page.getByTestId('duplicate-warning').getByRole('button', { name: 'Añadir igualmente' }).click();
    await expect(page.getByRole('checkbox', { name: /^Leche$/i })).toHaveCount(2);
  });

  test('browser back after "Terminar y apuntar gasto" does not show the cleared cart', async ({ page, request }) => {
    const data = await seedScenario(request, 'lists-prefilled');
    await loginAs(page, data.userA as Creds);
    await page.goto(`/lists/${data.groupListId}`);
    await expect(page.getByText('En el carro · 2')).toBeVisible();
    await page.getByRole('button', { name: 'Terminar y apuntar gasto' }).click();
    await expect(page).toHaveURL(/\/expenses\/new\?/);
    await page.goBack();
    await expect(page).toHaveURL(`/lists/${data.groupListId}`);
    // Well under the 6 s poll: the list re-reads on show.
    await expect(page.getByText(/En el carro/)).toHaveCount(0, { timeout: 3000 });
  });
});
