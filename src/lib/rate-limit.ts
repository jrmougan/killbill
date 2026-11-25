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

/**
 * Bound on live buckets. Keys are attacker-influenced (IPs, typed emails), so
 * without a cap a flood of distinct keys would grow the Map forever. Above the
 * cap expired buckets are swept first; if that is not enough, the oldest
 * buckets (Map insertion order) are evicted.
 */
export const MAX_BUCKETS = 10_000;
/** Expired buckets are also swept at most this often, on access. */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

function sweep(now: number) {
    lastSweep = now;
    for (const [key, entry] of store) {
        if (now >= entry.resetAt) store.delete(key);
    }
    if (store.size >= MAX_BUCKETS) {
        // Still full of live buckets: drop the oldest to make room.
        let excess = store.size - MAX_BUCKETS + 1;
        for (const key of store.keys()) {
            if (excess-- <= 0) break;
            store.delete(key);
        }
    }
}

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
    if (now - lastSweep >= SWEEP_INTERVAL_MS || store.size >= MAX_BUCKETS) {
        sweep(now);
    }

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

/** Test hook: number of live buckets. */
export function _rateLimitBucketCount(): number {
    return store.size;
}

/** Test hook: forget every bucket. */
export function _resetRateLimitStore(): void {
    store.clear();
    lastSweep = 0;
}

/**
 * Derives the client IP from headers set by the TRUSTED reverse proxy, falling
 * back to a constant when none are present (e.g. local dev without a proxy).
 *
 * Deployment assumption (Coolify + Traefik): Traefik is the ONLY ingress — the
 * app container's port is not published to the internet — and its entrypoints
 * do not trust forwarded headers from arbitrary clients (no
 * `forwardedHeaders.insecure`). Under that setup Traefik:
 *  - overwrites `X-Real-Ip` with the address of the peer it accepted the TCP
 *    connection from, and
 *  - APPENDS that same address to whatever `X-Forwarded-For` the client sent.
 *
 * So `X-Real-Ip` is authoritative, and the LAST `X-Forwarded-For` entry is the
 * one our proxy wrote. The FIRST entry is client-controlled and must never be
 * used as a rate-limit key: rotating it would give every request a fresh bucket.
 *
 * Accepts any Headers-like object (`Request.headers` in route handlers, or the
 * result of `await headers()` in Server Actions/Components).
 */
export function getClientIp(headers: { get(name: string): string | null }): string {
    const realIp = headers.get('x-real-ip')?.trim();
    if (realIp) {
        return realIp;
    }

    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
        if (hops.length > 0) return hops[hops.length - 1];
    }

    return 'unknown';
}
