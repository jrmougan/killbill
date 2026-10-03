import { test as base, expect, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { PageErrorGuard } from './page-error-guard';

export type NewContext = (options?: BrowserContextOptions) => Promise<BrowserContext>;

/** Use newContext for every manual session (including guests), never browser.newContext. */
export const test = base.extend<{ newContext: NewContext; pageErrorGuard: PageErrorGuard }>({
  // Playwright requires a literal object pattern to discover fixture dependencies.
  // oxlint-disable-next-line no-empty-pattern
  pageErrorGuard: [async ({}, use) => {
    const guard = new PageErrorGuard();
    try {
      await use(guard);
    } finally {
      guard.dispose();
      guard.assertNoErrors();
    }
  }, { auto: true }],

  context: async ({ context, pageErrorGuard }, use) => {
    pageErrorGuard.track(context);
    await use(context);
  },

  newContext: async ({ browser, pageErrorGuard, contextOptions, baseURL, viewport,
    userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId,
    colorScheme, storageState, ignoreHTTPSErrors, acceptDownloads }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({
        baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch,
        locale, timezoneId, colorScheme, storageState,
        ignoreHTTPSErrors, acceptDownloads, ...contextOptions, ...options,
      });
      pageErrorGuard.track(context);
      contexts.push(context);
      return context;
    });
    // Guard retains errors independently of browser.contexts(), even after an explicit close.
    for (const context of contexts) await context.close();
  },
});

export { expect };
