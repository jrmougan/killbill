import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT || '3000';
const baseURL = `http://localhost:${port}`;
// API fixtures create their own contexts; share the same worktree port.
process.env.TEST_BASE_URL = baseURL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  // In CI keep inline annotations and also write playwright-report/ for the uploaded artifact.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL,
    // The UI is hardcoded in Spanish; pin locale/timezone so dates and amounts are deterministic.
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile-first app (sm:max-w-md): run the same specs on a mobile Chromium viewport.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.CI ? 'node .next/standalone/server.js' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: port,
      NODE_ENV: 'test',
      TEST_ROUTES_ENABLED: 'true',
      // Guest/ephemeral surface must be on for e2e; flag-off behaviour is unit-tested.
      EPHEMERAL_SPACES_ENABLED: 'true',
    },
  },
});
