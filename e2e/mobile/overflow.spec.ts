import { test, expect } from '../fixtures/test.fixture';
import { request as playwrightRequest, type Page } from '@playwright/test';
import { seedScenario, resetDb } from '../fixtures/db.fixture';
import { loginAs } from '../fixtures/auth.fixture';

// Narrowest phone we support (iPhone SE 1st gen / small Androids).
const WIDTH = 320;

/**
 * The root <main> (layout.tsx) is `overflow-hidden`, so a page wider than the
 * screen never scrolls: its right edge is silently clipped. Lift every clip on
 * the page containers and measure the real document width instead.
 */
async function realWidth(page: Page): Promise<number> {
  await page.addStyleTag({ content: 'main, .overflow-x-hidden { overflow: visible !important; }' });
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test.describe('Mobile - no horizontal overflow at 320px', () => {
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

  const routes: Array<[string, (d: typeof data) => string]> = [
    ['dashboard', () => '/dashboard'],
    ['expenses list', () => '/expenses/list'],
    ['expense detail', (d) => `/expense/${d.expenseId}`],
    ['month budgets', () => '/month'],
    ['month analysis', () => '/month?view=analysis'],
    ['settle', () => '/settle'],
    ['settle history', () => '/settle/history'],
    ['settlement detail', (d) => `/settle/${d.settlementId}`],
    ['tags', () => '/tags'],
    ['spaces', () => '/spaces'],
    ['space detail', (d) => `/spaces/${d.coupleId}`],
  ];

  for (const [name, path] of routes) {
    test(`${name} fits the screen`, async ({ page }) => {
      await loginAs(page, data.userA!);
      await page.goto(path(data));
      await page.waitForLoadState('networkidle');

      // A long space name in the header meta must not squeeze the title away.
      const h1 = page.locator('header h1:not(.sr-only)').first();
      if (await h1.count()) {
        const box = await h1.boundingBox();
        expect(box?.width ?? 0, 'page title is visible').toBeGreaterThan(20);
      }

      expect(await realWidth(page)).toBeLessThanOrEqual(WIDTH);
    });
  }
});
