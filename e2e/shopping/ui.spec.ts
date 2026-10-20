import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

type Creds = { email: string; password: string; id: string };

test.describe('Shopping Lists - UI Happy Path', () => {
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

  test('group list: add, tick off, "Terminar y apuntar gasto" clears the cart and only opens a prefilled form', async ({ page }) => {
    const data = await seedScenario(apiContext, 'lists-prefilled');
    const userA = data.userA as Creds;
    const groupListId = data.groupListId as string;

    await loginAs(page, userA);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/);

    // The Listas tab opens straight onto the first Común list.
    await page.goto('/lists');
    await expect(page.getByRole('heading', { name: 'Listas' })).toBeVisible({ timeout: 10000 });
    const mercadonaChip = page.getByRole('button', { name: /^Mercadona, común, 4 pendientes$/ });
    await expect(mercadonaChip).toHaveAttribute('aria-pressed', 'true');
    await expect(mercadonaChip).toHaveText('Mercadona · 4');

    // Prefilled items: pending (aisle-grouped) and the "En el carro" section.
    await expect(page.getByRole('checkbox', { name: 'Leche' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Plátanos' })).toBeChecked();
    await expect(page.getByText('En el carro · 2')).toBeVisible();
    await expect(page.getByText('Lácteos y huevos')).toBeVisible();

    // Add an item (Enter adds; the aisle is auto-assigned server-side).
    const addItemInput = page.getByRole('textbox', { name: 'Añadir producto' });
    await addItemInput.fill('Manzanas');
    const postItemPromise = page.waitForResponse(
      (res) => res.url().includes(`/lists/${groupListId}/items`) && res.request().method() === 'POST'
    );
    await addItemInput.press('Enter');
    expect((await postItemPromise).ok()).toBeTruthy();
    await expect(page.getByRole('checkbox', { name: 'Manzanas' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Fruta y verdura')).toBeVisible();
    await expect(addItemInput).toHaveValue('');

    // Tick off "Leche" (idempotent checked API).
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/items/') && res.request().method() === 'PATCH'
    );
    await page.getByRole('checkbox', { name: 'Leche' }).check();
    expect((await patchPromise).ok()).toBeTruthy();
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toBeChecked();
    await expect(page.getByText('En el carro · 3')).toBeVisible();

    // Edit sheet keeps quantity/unit/note reachable.
    await page.getByRole('button', { name: 'Editar Pan' }).click();
    const editSheet = page.getByRole('dialog', { name: 'Editar producto' });
    await expect(editSheet.getByLabel('Cantidad')).toHaveValue('2');
    await editSheet.getByRole('button', { name: 'Cerrar' }).click();
    await expect(editSheet).toHaveCount(0);

    // Shortcut WITHOUT link: clears the checked items, then opens the
    // add-expense form prefilled — no expense is created by the list.
    const clearPromise = page.waitForResponse(
      (res) => res.url().includes(`/lists/${groupListId}/clear-checked`) && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Terminar y apuntar gasto' }).click();
    expect((await clearPromise).ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/expenses\/new\?/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('title')).toBe('Mercadona');
    expect(url.searchParams.get('category')).toBe('shopping');
    expect(url.searchParams.get('space')).toBeTruthy();
    expect(url.searchParams.get('returnTo')).toBe(`/lists/${groupListId}`);
    expect(url.searchParams.get('scan')).toBe('1');

    // The cart is gone, the pending items remain.
    await page.goto(`/lists/${groupListId}`);
    await expect(page.getByRole('checkbox', { name: 'Manzanas' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Plátanos' })).toHaveCount(0);
    await expect(page.getByText(/En el carro/)).toHaveCount(0);

    // INVARIANT: list actions never create an expense nor alter the balance.
    await page.goto('/dashboard');
    await expect(page.locator('[data-testid="balance-amount"]')).toHaveText(/0,00\s*€/);
    await page.goto('/expenses/list');
    await expect(page.getByText('Todavía no hay gastos.')).toBeVisible();
  });

  test('"Borrar los tachados" asks first, "Eliminar producto" has Deshacer and "Eliminar lista" says what it deletes', async ({ page }) => {
    const data = await seedScenario(apiContext, 'lists-prefilled');
    const userA = data.userA as Creds;
    const groupListId = data.groupListId as string;

    await loginAs(page, userA);
    await page.goto(`/lists/${groupListId}`);
    await expect(page.getByText('En el carro · 2')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('finish-effect')).toHaveText('Quita de la lista los 2 productos tachados');

    let clearCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/clear-checked') && req.method() === 'POST') clearCalls++;
    });

    // The menu entry only opens the review sheet; Cancelar leaves the cart as is.
    await page.getByRole('button', { name: 'Opciones de Mercadona' }).click();
    await page.getByRole('button', { name: 'Borrar los tachados (2)' }).click();
    const clearSheet = page.getByRole('alertdialog', { name: '¿Borrar 2 productos tachados?' });
    await expect(clearSheet).toContainText('Se quitarán de la lista para todo el espacio. Los pendientes no cambian.');
    await expect(clearSheet).toContainText('No se puede deshacer.');
    await clearSheet.getByTestId('confirm-sheet-cancel').click();
    await expect(clearSheet).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Plátanos' })).toBeChecked();
    expect(clearCalls).toBe(0);

    // Only confirm-sheet-confirm deletes them (no Deshacer on this toast).
    await page.getByRole('button', { name: 'Opciones de Mercadona' }).click();
    await page.getByRole('button', { name: 'Borrar los tachados (2)' }).click();
    const clearPromise = page.waitForResponse(
      (res) => res.url().includes(`/lists/${groupListId}/clear-checked`) && res.request().method() === 'POST'
    );
    await page.getByRole('alertdialog').getByTestId('confirm-sheet-confirm').click();
    expect((await clearPromise).ok()).toBeTruthy();
    expect(clearCalls).toBe(1);
    await expect(page.getByText('2 productos borrados')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deshacer' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Plátanos' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Leche' })).toBeVisible();

    // Deleting a product needs no modal and can be undone with the same data.
    await page.getByRole('button', { name: 'Editar Pan' }).click();
    await page.getByRole('dialog', { name: 'Editar producto' }).getByRole('button', { name: 'Eliminar producto' }).click();
    await expect(page.getByText('«Pan» eliminado')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Pan' })).toHaveCount(0);
    const restorePromise = page.waitForResponse(
      (res) => res.url().includes(`/lists/${groupListId}/items`) && res.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Deshacer' }).click();
    expect((await restorePromise).ok()).toBeTruthy();
    await expect(page.getByRole('checkbox', { name: 'Pan' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Editar Pan' }).click();
    const editSheet = page.getByRole('dialog', { name: 'Editar producto' });
    await expect(editSheet.getByLabel('Cantidad')).toHaveValue('2');
    await expect(editSheet.getByLabel('Unidad')).toHaveValue('ud');
    await expect(editSheet.getByLabel('Pasillo')).toHaveValue('panaderia');
    await editSheet.getByRole('button', { name: 'Cerrar' }).click();

    // Eliminar lista: danger sheet with the scope and the count, then a flash toast.
    await page.getByRole('button', { name: 'Opciones de Mercadona' }).click();
    await page.getByRole('button', { name: 'Eliminar lista' }).click();
    const deleteSheet = page.getByRole('alertdialog', { name: '¿Eliminar «Mercadona»?' });
    await expect(deleteSheet).toContainText('Se eliminarán sus 4 productos para todos los miembros del espacio. No afecta a ningún gasto.');
    await deleteSheet.getByRole('button', { name: 'Eliminar lista' }).click();
    await expect(page.getByText('Lista «Mercadona» eliminada')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /^Mercadona, común/ })).toHaveCount(0);
  });

  test('personal list: switch via chip, dimmed shortcut and create a new personal list', async ({ page }) => {
    const data = await seedScenario(apiContext, 'lists-prefilled');
    const userA = data.userA as Creds;
    const personalListId = data.personalListId as string;

    await loginAs(page, userA);
    await page.goto('/lists');

    // Personal lists sit after the Común ones.
    const farmaciaChip = page.getByRole('button', { name: /^Farmacia, personal, 1 pendientes$/ });
    await expect(farmaciaChip).toBeVisible({ timeout: 10000 });
    await farmaciaChip.click();
    await expect(page).toHaveURL(`/lists/${personalListId}`);
    await expect(page.getByRole('button', { name: /^Farmacia, personal/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: 'Ibuprofeno' })).toBeVisible();

    // Untick the only checked item → the shortcut is dimmed and only nudges.
    await page.getByRole('checkbox', { name: 'Agua' }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Agua' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Terminar y apuntar gasto' }).click();
    await expect(page.getByText('Marca lo que has cogido')).toBeVisible();
    await expect(page).toHaveURL(`/lists/${personalListId}`);

    // "+ Nueva" → sheet → personal list.
    await page.getByRole('button', { name: '+ Nueva' }).click();
    const sheet = page.getByRole('dialog', { name: 'Nueva lista' });
    await sheet.getByRole('radio', { name: 'Personal' }).check();
    await sheet.getByLabel('Nombre').fill('Ferretería');
    const createPromise = page.waitForResponse(
      (res) => res.url().includes('/api/me/lists') && res.request().method() === 'POST'
    );
    await sheet.getByRole('button', { name: 'Crear lista' }).click();
    expect((await createPromise).ok()).toBeTruthy();

    await expect(page.getByRole('button', { name: /^Ferretería, personal, 0 pendientes$/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await expect(page.getByText('Lista vacía. Añade el primer producto.')).toBeVisible();
  });
});
