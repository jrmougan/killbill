import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('QA project and CI policy', () => {
  it('keeps retries visible and makes flaky retries fail CI with no report server', async () => {
    vi.stubEnv('CI', 'true');
    const { default: config } = await import('../../playwright.config');
    expect(config.failOnFlakyTests).toBe(true);
    expect(config.retries).toBe(2);
    expect(config.workers).toBe(1);
    expect(config.use?.trace).toBe('retain-on-failure-and-retries');
    expect(config.reporter).toContainEqual(['html', { open: 'never' }]);
    expect(config.reporter).toContainEqual(['./e2e/fixtures/ci-reporter.ts']);
    const projects = config.projects!;
    expect(projects.map(p => p.name)).toEqual(['api', 'chromium', 'mobile-chrome']);
    expect(projects[0].testMatch).toEqual(projects[1].testIgnore);
    expect(projects[0].testMatch).toEqual(projects[2].testIgnore);
    expect(projects[0].testMatch).not.toContain('**/api/authz.spec.ts');
  });

  it('also disables automatic HTML serving locally', async () => {
    vi.stubEnv('CI', '');
    const { default: config } = await import('../../playwright.config');
    expect(config.reporter).toEqual([['html', { open: 'never' }]]);
    expect(config.failOnFlakyTests).toBe(false);
  });
});
