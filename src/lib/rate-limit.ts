// Simple dependency-free in-memory fixed-window rate limiter.
//
// CAVEAT: state lives in process memory only. It does NOT survive restarts
// and is NOT shared across multiple instances/containers. This is acceptable
// for the current single-container deploy, but a shared store (e.g. Redis)
// is the real fix if the app is ever horizontally scaled.

type WindowEntry = {
    count: number;
    resetAt: number;
};

const store = new Map<string, WindowEntry>();

export type RateLimitResult = {
    allowed: boolean;
    retryAfterSeconds: number;
};

/**
 * Fixed-window rate limit check.
 * @param key   Unique bucket key (e.g. `login:1.2.3.4`).
 * @param limit Max requests allowed within the window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    // Never rate-limit when test routes are enabled: the e2e suite performs many
    // logins from the same (proxy-less) client, which would otherwise all share
    // one bucket and trip the limit. Rate limiting is a production protection.
    // TEST_ROUTES_ENABLED is the same reliable signal the test-only API routes
    // use (NODE_ENV is forced by Next at build/dev and is not trustworthy here).
    if (process.env.TEST_ROUTES_ENABLED === 'true') {
        return { allowed: true, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
    }

    if (entry.count >= limit) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
    }

    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Derives a best-effort client identifier from proxy headers, falling back to
 * a constant when none are present (e.g. local dev without a proxy).
 *
 * Accepts any Headers-like object (`Request.headers` in route handlers, or the
 * result of `await headers()` in Server Actions/Components).
 */
export function getClientIp(headers: { get(name: string): string | null }): string {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        // x-forwarded-for may be a comma-separated list; the first is the client.
        return forwarded.split(',')[0].trim();
    }

    const realIp = headers.get('x-real-ip');
    if (realIp) {
        return realIp.trim();
    }

    return 'unknown';
}
