import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _rateLimitBucketCount, _resetRateLimitStore, getClientIp, MAX_BUCKETS, rateLimit } from "./rate-limit";

const h = (headers: Record<string, string>) => new Headers(headers);

describe("getClientIp", () => {
    it("prefers X-Real-Ip (set by the trusted proxy)", () => {
        expect(getClientIp(h({ "x-real-ip": " 9.9.9.9 ", "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
    });

    it("ignores a spoofed first X-Forwarded-For entry and uses the proxy-appended last one", () => {
        expect(getClientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2,  203.0.113.7 " }))).toBe("203.0.113.7");
    });

    it("rotating the client-controlled prefix does not change the key", () => {
        const a = getClientIp(h({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }));
        const b = getClientIp(h({ "x-forwarded-for": "10.0.0.2, 203.0.113.7" }));
        expect(a).toBe(b);
    });

    it("falls back to 'unknown' without proxy headers or with an empty list", () => {
        expect(getClientIp(h({}))).toBe("unknown");
        expect(getClientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown");
    });
});

describe("rateLimit", () => {
    const original = process.env.TEST_ROUTES_ENABLED;
    beforeEach(() => {
        delete process.env.TEST_ROUTES_ENABLED;
        _resetRateLimitStore();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
        if (original === undefined) delete process.env.TEST_ROUTES_ENABLED;
        else process.env.TEST_ROUTES_ENABLED = original;
    });

    it("allows up to the limit then blocks with a retry-after", () => {
        for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
        const blocked = rateLimit("k", 3, 60_000);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSeconds).toBe(60);
        vi.advanceTimersByTime(60_000);
        expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    });

    it("sweeps expired buckets on access", () => {
        rateLimit("a", 1, 1_000);
        rateLimit("b", 1, 1_000);
        expect(_rateLimitBucketCount()).toBe(2);
        vi.advanceTimersByTime(61_000);
        rateLimit("c", 1, 1_000);
        expect(_rateLimitBucketCount()).toBe(1);
    });

    it("never grows past MAX_BUCKETS even with live buckets", () => {
        for (let i = 0; i < MAX_BUCKETS + 50; i++) rateLimit(`flood:${i}`, 1, 3_600_000);
        expect(_rateLimitBucketCount()).toBeLessThanOrEqual(MAX_BUCKETS);
        // The newest bucket survives eviction (oldest go first).
        expect(rateLimit(`flood:${MAX_BUCKETS + 49}`, 1, 3_600_000).allowed).toBe(false);
    });
});
