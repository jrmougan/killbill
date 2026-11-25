import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CiReporter from './ci-reporter';

const originalCwd = process.cwd();
const dirs: string[] = [];
afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'killbill-qa-'));
  dirs.push(dir);
  process.chdir(dir);
  vi.stubEnv('GITHUB_STEP_SUMMARY', join(dir, 'github-summary.md'));
  return dir;
}

describe('CI attempt summary', () => {
  it('retains first failure artifacts and identifies a passing retry as flaky', () => {
    const dir = setup();
    const reporter = new CiReporter();
    let outcome = 'unexpected';
    const test = {
      titlePath: () => ['chromium', 'expenses', 'create | expense'],
      expectedStatus: 'passed',
      location: { file: 'e2e/expenses/create.spec.ts', line: 42 },
      outcome: () => outcome,
    } as TestCase;
    reporter.onTestEnd(test, {
      status: 'failed', retry: 0,
      errors: [{ message: 'Unhandled error\nwith detail' }],
      attachments: [{ name: 'trace', path: 'test-results/first/trace.zip' }],
    } as TestResult);
    outcome = 'flaky';
    reporter.onTestEnd(test, { status: 'passed', retry: 1, errors: [], attachments: [] } as unknown as TestResult);
    reporter.onEnd({ status: 'failed' } as FullResult);
    const summary = readFileSync(join(dir, 'test-results/qa-summary.md'), 'utf8');
    expect(summary).toContain('Failed attempts: **1**. Flaky tests: **1**');
    expect(summary).toContain('| 1 | failed | e2e/expenses/create.spec.ts:42');
    expect(summary).toContain('test-results/first/trace.zip');
    expect(summary).toContain('Unhandled error with detail');
    expect(summary).toContain(String.raw`create \| expense`);
    expect(readFileSync(join(dir, 'github-summary.md'), 'utf8')).toBe(summary);
  });

  it('does not report expected failures or skipped tests as failed attempts', () => {
    const dir = setup();
    const reporter = new CiReporter();
    const test = { titlePath: () => ['api', 'expected failure'], expectedStatus: 'failed',
      location: { file: 'test.ts', line: 1 }, outcome: () => 'expected' } as TestCase;
    for (const status of ['failed', 'skipped']) {
      reporter.onTestEnd(test, { status, retry: 0, errors: [], attachments: [] } as unknown as TestResult);
    }
    reporter.onEnd({ status: 'passed' } as FullResult);
    expect(readFileSync(join(dir, 'test-results/qa-summary.md'), 'utf8')).toContain('Failed attempts: **0**. Flaky tests: **0**');
  });
});
