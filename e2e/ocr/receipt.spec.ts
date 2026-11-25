import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.fixture';
import { readPersistedReceipt } from './persisted-receipt';
import { loginAs } from '../fixtures/auth.fixture';
import { seedScenario, resetDb } from '../fixtures/db.fixture';

const receiptPath = path.join(process.cwd(), 'e2e/ocr/receipt.png');

test.beforeEach(async ({ request }) => { await resetDb(request); });
test.afterEach(async ({ request }) => { await resetDb(request); });

test('scan, review, correct and assign a receipt before saving exact cents', async ({ page, request, newContext }) => {
  const data = await seedScenario(request, 'couple-no-expenses');
  const userA = data.userA!;
  const userB = data.userB!;
  await loginAs(page, { email: userA.email, password: userA.password! });
  await page.goto('/expenses/new');

  // No browser routes are mocked: the image crosses the authenticated OCR route
  // and the server's controlled provider HTTP boundary before being reviewed.
  const ocrResponse = page.waitForResponse(response => response.url().endsWith('/api/ocr') && response.request().method() === 'POST');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Escanear recibo', exact: true }).click();
  await (await chooser).setFiles(receiptPath);
  const parsed = await ocrResponse;
  expect(parsed.status()).toBe(200);
  expect(await parsed.json()).toMatchObject({
    success: true, store: 'Tienda E2E', total: 6.75,
    items: [
      { description: 'Pan', total: 3.4, assignedTo: null },
      { description: 'Cafe', total: 2.15, assignedTo: null },
      { description: 'Leche', total: 1.2, assignedTo: null },
    ],
  });
  // The scan returns straight to the prefilled form (EQUIL): badge + amount +
  // concept; the receipt lines are reviewed under "Más opciones".
  await expect(page.getByText('Ticket leído · revisa y guarda')).toBeVisible();
  await expect(page.getByTestId('expense-amount')).toHaveValue('6,75');
  await expect(page.getByTestId('expense-description')).toHaveValue('Tienda E2E');
  await page.getByRole('button', { name: /Más opciones/ }).click();
  await expect(page.getByRole('textbox', { name: 'Precio del producto 2', exact: true })).toHaveValue('2,15');
  await page.getByRole('textbox', { name: 'Precio del producto 2', exact: true }).fill('2,65');
  await page.getByRole('textbox', { name: 'Precio del producto 3', exact: true }).fill('1,21');
  await page.getByRole('textbox', { name: 'Cantidad del producto 3', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Solo mío', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Solo User B', exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Solo mío', exact: true }).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Solo User B', exact: true }).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Compartido 50/50', exact: true }).nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByTestId('expense-amount')).toHaveValue('8,47');
  await expect(page.getByTestId('expense-split')).toContainText('Por productos');
  await page.getByTestId('expense-description').fill('Compra revisada OCR');

  const uploadResponse = page.waitForResponse(response => response.url().endsWith('/api/upload') && response.request().method() === 'POST');
  const createResponse = page.waitForResponse(response => response.url().endsWith('/api/expenses') && response.request().method() === 'POST');
  await page.getByTestId('expense-submit').click();
  const uploaded = await uploadResponse;
  expect(uploaded.status()).toBe(200);
  const upload = await uploaded.json();
  expect(upload.success).toBe(true);
  expect(upload.url).toMatch(/^\/uploads\/[a-f0-9-]+\.png$/);
  const created = await createResponse;
  expect(created.status()).toBe(200);
  const { expenseId } = await created.json();
  await expect(page).toHaveURL(/\/dashboard/);

  // Read the committed row and relations: request payloads alone cannot prove
  // either the integer-cent conversion or that the receipt stayed associated.
  const saved = await readPersistedReceipt(expenseId);
  expect(saved).toMatchObject({ amount: 847, description: 'Compra revisada OCR', paidById: userA.id, receiptUrl: upload.url });
  expect(saved.splits.map(split => ({ userId: split.userId, amount: split.amount })))
    .toEqual(expect.arrayContaining([{ userId: userA.id, amount: 461 }, { userId: userB.id, amount: 386 }]));
  expect(saved.splits).toHaveLength(2);
  expect(saved.lineItems.map(item => ({ description: item.description, quantity: item.quantity,
    unitPrice: item.unitPrice, lineTotal: item.lineTotal, assignedToId: item.assignedToId })))
    .toEqual([
      { description: 'Pan', quantity: 1, unitPrice: 340, lineTotal: 340, assignedToId: userA.id },
      { description: 'Cafe', quantity: 1, unitPrice: 265, lineTotal: 265, assignedToId: userB.id },
      { description: 'Leche', quantity: 2, unitPrice: 121, lineTotal: 242, assignedToId: null },
    ]);
  const balance = await page.request.get(`/api/spaces/${data.coupleId}/balance`);
  expect(balance.status()).toBe(200);
  expect((await balance.json()).balances).toEqual({ [userA.id!]: 386, [userB.id!]: -386 });
  const storedImage = await page.request.get(upload.url);
  expect(storedImage.status()).toBe(200);
  expect(await storedImage.body()).toEqual(await readFile(receiptPath));
  await page.reload();
  await expect(page.getByTestId('balance-amount')).toContainText('3,86');
  await page.goto('/expenses/list');
  await expect(page.getByText('Compra revisada OCR', { exact: true })).toBeVisible();

  // The other member sees the persisted debt through an independent guarded UI session.
  const partnerContext = await newContext();
  const partnerPage = await partnerContext.newPage();
  await loginAs(partnerPage, { email: userB.email, password: userB.password! });
  await expect(partnerPage.getByTestId('balance-amount')).toContainText('3,86');
  await expect(partnerPage.getByTestId('balance-amount')).toContainText('-');
});

