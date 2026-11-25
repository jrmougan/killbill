import type { NewContext } from './test.fixture';
import { Page, BrowserContext } from '@playwright/test';

export async function loginAs(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', credentials.email);
  await page.fill('[data-testid="login-password"]', credentials.password);
  await page.click('[data-testid="login-submit"]');
  // A first-run account (no space, no expense) lands on the optional /welcome
  // onboarding; the specs that use this helper want Inicio.
  await page.waitForURL(/\/(dashboard|welcome)(\?|$)/);
  if (new URL(page.url()).pathname === '/welcome') await page.goto('/dashboard');
}

export async function createAuthenticatedContext(newContext: NewContext, credentials: { email: string; password: string }): Promise<BrowserContext> {
  const context = await newContext();
  const page = await context.newPage();
  await loginAs(page, credentials);
  await page.close();
  return context;
}
