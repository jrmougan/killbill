import { EventEmitter } from 'node:events';
import type { BrowserContext, WebError } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { PageErrorGuard } from './page-error-guard';

function context() {
  const events = new EventEmitter();
  return { events, context: events as unknown as BrowserContext };
}
function error(message: string, url: string | null) {
  return {
    error: () => new Error(message),
    page: () => url === null ? null : { url: () => url },
  } as WebError;
}

describe('context-wide pageerror guard', () => {
  it('fails on errors from multiple new pages, including a closed manual context', () => {
    const guard = new PageErrorGuard();
    const main = context();
    const manual = context();
    guard.track(main.context);
    guard.track(manual.context);
    main.events.emit('weberror', error('new tab failure', '/tab'));
    manual.events.emit('weberror', error('guest popup failure', '/popup'));
    manual.events.emit('close');
    manual.events.removeAllListeners();
    guard.dispose();
    expect(() => guard.assertNoErrors()).toThrow(/Unhandled browser page errors \(2\)/);
    expect(() => guard.assertNoErrors()).toThrow('/popup');
    expect(() => guard.assertNoErrors()).toThrow('guest popup failure');
  });

  it('registers each context once and detaches without discarding unknown-page errors', () => {
    const guard = new PageErrorGuard();
    const main = context();
    guard.track(main.context);
    guard.track(main.context);
    expect(main.events.listenerCount('weberror')).toBe(1);
    main.events.emit('weberror', error('early failure', null));
    guard.dispose();
    expect(main.events.listenerCount('weberror')).toBe(0);
    expect(() => guard.assertNoErrors()).toThrow('<unknown page>');
  });

  it('allows a context with no unhandled errors', () => {
    const guard = new PageErrorGuard();
    guard.track(context().context);
    guard.dispose();
    expect(() => guard.assertNoErrors()).not.toThrow();
  });
});
