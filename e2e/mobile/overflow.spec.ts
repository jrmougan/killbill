import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// Narrowest phone we support (iPhone SE 1st gen / small Androids) and iPhone 15.
const WIDTHS = [320, 393];

/**
 * The root <main> (layout.tsx) is `overflow-hidden`, so a page wider than the
 * screen never scrolls: its right edge is silently clipped. Lift every clip on
 * the page containers and measure the real document width instead.
 */
async function realWidth(page: Page): Promise<number> {
  await page.addStyleTag({ content: 'main, .overflow-x-hidden { overflow: visible !important; }' });
  return page.evaluate(() => document.documentElement.scrollWidth);
}

/**
 * iOS Safari zooms the page when a focused control computes below 16px (and stays
 * zoomed). Same control types as the floor in globals.css; returns the offenders.
 */
async function controlsBelow16px(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const exempt = ['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'button', 'submit', 'reset', 'image'];
    return [...document.querySelectorAll<HTMLInputElement>('input, select, textarea')]
      .filter((el) => el.getClientRects().length > 0 && !exempt.includes(el.type))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? el.name ?? el.id}: ${getComputedStyle(el).fontSize}`);
  });
}

/** Amount fields must show their whole value without scrolling inside the input. */
async function clippedAmountFields(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"], input[type="number"]')]
      .filter((el) => el.getClientRects().length > 0 && el.scrollWidth > el.clientWidth)
      .map((el) => `${el.getAttribute('aria-label') ?? el.id}: "${el.value}" ${el.scrollWidth} > ${el.clientWidth}`),
  );
}

for (const WIDTH of WIDTHS) {
  test.describe(`Mobile - no horizontal overflow at ${WIDTH}px`, () => {
    test.use({ viewport: { width: WIDTH, height: 640 } });

    let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
    let data: Awaited<ReturnType<typeof seedScenario>>;

    test.beforeAll(async ({ playwright }) => {
      apiContext = await playwright.request.newContext({
        baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
      });
      await resetDb(apiContext);
      data = await seedScenario(apiContext, 'mobile-stress');
    });

    test.afterAll(async () => {
      await resetDb(apiContext);
      await apiContext.dispose();
    });

    // Layout-only check: the mobile project is enough.
    test.skip(({ isMobile }) => !isMobile, 'runs on the mobile project only');

    // `userB` owes the stress settlement: the debtor sees different screens.
    const routes: Array<[string, (d: typeof data) => string, 'userA' | 'userB' | null]> = [
      ['dashboard', () => '/dashboard', 'userA'],
      ['dashboard as debtor', () => '/dashboard', 'userB'],
      ['expenses list', () => '/expenses/list', 'userA'],
      ['new expense', () => '/expenses/new', 'userA'],
      ['import expenses', () => '/expenses/import', 'userA'],
      ['expense detail', (d) => `/expense/${d.expenseId}`, 'userA'],
      ['edit expense', (d) => `/expense/${d.expenseId}/edit`, 'userA'],
      ['month budgets', () => '/month', 'userA'],
      ['month analysis', () => '/month?view=analysis', 'userA'],
      ['settle', () => '/settle', 'userA'],
      ['settle as debtor', () => '/settle', 'userB'],
      ['settle history', () => '/settle/history', 'userA'],
      ['settlement detail', (d) => `/settle/${d.settlementId}`, 'userA'],
      ['edit settlement', (d) => `/settle/${d.settlementId}/edit`, 'userB'],
      ['tags', () => '/tags', 'userA'],
      ['categories', () => '/categories', 'userA'],
      ['lists', () => '/lists', 'userA'],
      ['settings', () => '/settings', 'userA'],
      ['personal', () => '/personal', 'userA'],
      ['spaces', () => '/spaces', 'userA'],
      ['new space', () => '/spaces/new', 'userA'],
      ['space detail', (d) => `/spaces/${d.coupleId}`, 'userA'],
      ['close space', (d) => `/spaces/${d.coupleId}/close`, 'userA'],
      ['login', () => '/login', null],
      ['register', () => '/register', null],
    ];

    for (const [name, path, user] of routes) {
      test(`${name} fits the screen`, async ({ page }) => {
        if (user) await loginAs(page, data[user]!);
        await page.goto(path(data));
        await page.waitForLoadState('networkidle');
        // A lost session lands on /login, which fits the screen and would pass this sweep.
        if (user) expect(new URL(page.url()).pathname).not.toBe('/login');

        // A long space name in the header meta must not squeeze the title away.
        const h1 = page.locator('header h1:not(.sr-only)').first();
        if (await h1.count()) {
          const box = await h1.boundingBox();
          expect(box?.width ?? 0, 'page title is visible').toBeGreaterThan(20);
        }

        expect(await controlsBelow16px(page), 'no control triggers the iOS focus zoom').toEqual([]);
        expect(await clippedAmountFields(page), 'amount fields show their whole value').toEqual([]);
        expect(await realWidth(page)).toBeLessThanOrEqual(WIDTH);
      });
    }

    test('the current month amount stays inside the bar chart', async ({ page }) => {
      await loginAs(page, data.userA!);
      await page.goto('/month?view=analysis');
      const current = page.getByTestId('bar-current');
      // Visible first: while the route streams, the content sits in a hidden boundary.
      await expect(current).toBeVisible();
      await expect(current).toHaveText('1.000.000 €');
      const amount = await current.boundingBox();
      expect(amount!.x).toBeGreaterThanOrEqual(0);
      expect(amount!.x + amount!.width).toBeLessThanOrEqual(WIDTH);
    });

    test('"Más opciones" of the expense form fits and does not zoom', async ({ page }) => {
      await loginAs(page, data.userA!);
      await page.goto('/expenses/new');
      await page.getByRole('button', { name: 'Más opciones' }).click();
      await expect(page.getByTestId('expense-date')).toBeVisible();

      expect(await controlsBelow16px(page)).toEqual([]);
      const date = await page.getByTestId('expense-date').boundingBox();
      expect(date!.x + date!.width).toBeLessThanOrEqual(WIDTH);

      // Compact receipt fields: the 16px floor must not clip a five-digit price.
      await page.getByRole('button', { name: 'Añadir producto' }).click();
      await page.getByRole('textbox', { name: 'Precio del producto 1' }).fill('12345,67');
      expect(await controlsBelow16px(page)).toEqual([]);
      expect(await clippedAmountFields(page), 'amount fields show their whole value').toEqual([]);
      expect(await realWidth(page)).toBeLessThanOrEqual(WIDTH);
    });
  });
}

test.describe('Desktop keeps its compact controls', () => {
  test.skip(({ isMobile }) => isMobile, 'the 16px floor is for phones; this guards the wide layout');

  test('the phone font floor does not leak into a wide pointer-driven window', async ({ page }) => {
    await page.goto('/login');
    const size = await page.getByTestId('login-email').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeLessThan(16);
  });
});
