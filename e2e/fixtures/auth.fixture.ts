import { Page, Browser, BrowserContext } from '@playwright/test';

export async function loginAs(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', credentials.email);
  await page.fill('[data-testid="login-password"]', credentials.password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('**/dashboard');
}

export async function createAuthenticatedContext(browser: Browser, credentials: { email: string; password: string }): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, credentials);
  await page.close();
  return context;
}
