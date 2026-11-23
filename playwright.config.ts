import { defineConfig, devices } from '@playwright/test';
import { testDatabaseRefusal, worktreeDatabaseEnv } from './src/lib/test-db-guard.mjs';

// The suite (and ux:capture) resets its database: it always runs against this
// worktree's own MySQL (WORKTREE_DATABASE_* from .env), even when .env points the
// app at the shared prod replica, and aborts if it still resolves to the replica.
// Runner, workers and the web server all inherit these DATABASE_* values.
try { process.loadEnvFile(); } catch { /* no .env: CI passes real variables */ }
Object.assign(process.env, worktreeDatabaseEnv(process.env));
const dbRefusal = testDatabaseRefusal(process.env);
if (dbRefusal) throw new Error(`E2E resets its database, refusing to run: ${dbRefusal}`);

const port = process.env.PORT || '3000';
const baseURL = `http://localhost:${port}`;
// API contract assertions run once; authz contains real guest navigation assertions.
const apiSuites = ['**/api/crud.spec.ts', '**/api/mcp.spec.ts', '**/api/ai-settings.spec.ts', '**/api/invites.spec.ts', '**/shopping/smoke.spec.ts', '**/*.api.spec.ts'];
// API fixtures create their own contexts; share the same worktree port.
process.env.TEST_BASE_URL = baseURL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI keep inline annotations and also write playwright-report/ for the uploaded artifact.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['./e2e/fixtures/ci-reporter.ts']]
    : [['html', { open: 'never' }]],
  use: {
    baseURL,
    // The UI is hardcoded in Spanish; pin locale/timezone so dates and amounts are deterministic.
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure-and-retries',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: apiSuites },
    { name: 'chromium', testIgnore: apiSuites, use: { ...devices['Desktop Chrome'] } },
    // Mobile-first app (sm:max-w-md): run the same specs on a mobile Chromium viewport.
    { name: 'mobile-chrome', testIgnore: apiSuites, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.CI
      ? 'node e2e/ocr/test-server.mjs standalone'
      : 'node e2e/ocr/test-server.mjs dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: port,
      TZ: 'UTC',
      NODE_ENV: 'test',
      TEST_ROUTES_ENABLED: 'true',
      // Guest/ephemeral surface must be on for e2e; flag-off behaviour is unit-tested.
      EPHEMERAL_SPACES_ENABLED: 'true',
    },
  },
});
