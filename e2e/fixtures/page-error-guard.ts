import type { BrowserContext, WebError } from '@playwright/test';

/** Context-level weberror covers pageerror on existing pages, new tabs and popups. */
export class PageErrorGuard {
  private readonly errors: string[] = [];
  private readonly listeners = new Map<BrowserContext, (error: WebError) => void>();

  track(context: BrowserContext): void {
    if (this.listeners.has(context)) return;
    const listener = (event: WebError) => {
      const error = event.error();
      this.errors.push(`${event.page()?.url() ?? '<unknown page>'}\n${error.stack ?? error.message}`);
    };
    this.listeners.set(context, listener);
    context.on('weberror', listener);
  }

  dispose(): void {
    for (const [context, listener] of this.listeners) context.off('weberror', listener);
    this.listeners.clear();
  }

  assertNoErrors(): void {
    if (this.errors.length) {
      throw new Error(`Unhandled browser page errors (${this.errors.length}):\n\n${this.errors.join('\n\n')}`);
    }
  }
}
