import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

/** Keep failed attempts visible even if a later retry passes. */
export default class CiReporter implements Reporter {
  private readonly attempts: string[] = [];
  private readonly flaky = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const name = test.titlePath().filter(Boolean).join(' › ');
    if (result.status !== test.expectedStatus && result.status !== 'skipped') {
      const location = `${test.location.file}:${test.location.line}`;
      const artifacts = result.attachments.map(a => a.path).filter(Boolean).join(', ');
      const error = result.errors.map(e => e.message ?? '').join('; ');
      this.attempts.push(`| ${cell(name)} | ${result.retry + 1} | ${result.status} | ${cell(location)} | ${cell(error)} | ${cell(artifacts || 'See playwright-report')} |`);
    }
    if (test.outcome() === 'flaky') this.flaky.add(name);
  }

  onEnd(result: FullResult): void {
    const summary = [
      '## Playwright QA',
      `Result: **${result.status}**. Failed attempts: **${this.attempts.length}**. Flaky tests: **${this.flaky.size}**.`,
      'CI fails on flaky retries. Download the playwright-report artifact for HTML details and test-results traces/screenshots, including first-attempt failures.',
      ...(this.attempts.length ? [
        '| Test / project | Attempt | Status | Source | Error | Artifacts |',
        '| --- | --- | --- | --- | --- | --- |',
        ...this.attempts,
      ] : []),
      ...[...this.flaky].map(name => `- Flaky: ${cell(name)}`),
      '',
    ].join('\n');
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/qa-summary.md', summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
