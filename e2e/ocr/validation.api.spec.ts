import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.fixture';
import { loginAs } from '../fixtures/auth.fixture';
import { seedScenario, resetDb } from '../fixtures/db.fixture';

const receiptPath = path.join(process.cwd(), 'e2e/ocr/receipt.png');

test.beforeEach(async ({ request }) => { await resetDb(request); });
test.afterEach(async ({ request }) => { await resetDb(request); });

test('OCR rejects anonymous, missing, spoofed and oversized images before provider parsing', async ({ request, newContext }) => {
  const image = await readFile(receiptPath);
  const anonymous = await request.post('/api/ocr', { multipart: { image: { name: 'receipt.png', mimeType: 'image/png', buffer: image } } });
  expect(anonymous.status()).toBe(401);
  const data = await seedScenario(request, 'couple-no-expenses');
  const context = await newContext();
  const page = await context.newPage();
  await loginAs(page, { email: data.userA!.email, password: data.userA!.password! });
  const missing = await page.request.post('/api/ocr', { multipart: { unrelated: 'no-image' } });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toBe('No image provided');
  const invalidType = await page.request.post('/api/ocr', { multipart: { image: { name: 'receipt.txt', mimeType: 'text/plain', buffer: image } } });
  expect(invalidType.status()).toBe(400);
  const spoofed = await page.request.post('/api/ocr', { multipart: { image: { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('This is not an actual PNG image') } } });
  expect(spoofed.status()).toBe(400);
  expect((await spoofed.json()).error).toBe('Invalid image file');
  const oversized = await page.request.post('/api/ocr', { multipart: { image: { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) } } });
  expect(oversized.status()).toBe(413);
});
