import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const root = path.resolve(__dirname, '../..');

// Screenshot harness for the Ralph UX loop (scripts/ralph/README.md). Reuses the
// e2e web server (test routes on, own DB reset) but only runs capture.spec.ts on a
// phone viewport matching the 360×760 mockups in docs/design.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'capture.spec.ts',
  reporter: [['list']],
  retries: 0,
  outputDir: '../../test-results/ralph',
  use: {
    ...base.use,
    viewport: { width: 360, height: 760 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  projects: [{ name: 'ux' }],
  // The base command is relative to the repo root, not to this config's folder.
  webServer: { ...(base.webServer as object), cwd: root } as typeof base.webServer,
});
