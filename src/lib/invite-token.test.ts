import { describe, it, expect } from "vitest";
import {
    generateInviteToken,
    hashInviteToken,
    tokenPrefix,
    evaluateInvite,
    inviteInvalidMessage,
    INVITE_TOKEN_PREFIX_LEN,
    type InviteState,
} from "./invite-token";

describe("invite-token", () => {
    describe("generateInviteToken", () => {
        it("produces a 256-bit URL-safe token (43 base64url chars, no padding)", () => {
            const t = generateInviteToken();
            // 32 bytes -> ceil(32/3)*4 = 44 with padding; base64url drops the '=' -> 43.
            expect(t).toHaveLength(43);
            expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it("is effectively unique across calls", () => {
            const seen = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
            expect(seen.size).toBe(200);
        });
    });

    describe("hashInviteToken", () => {
        it("is deterministic and 64 hex chars (sha256)", () => {
            const t = "some-token";
            expect(hashInviteToken(t)).toBe(hashInviteToken(t));
            expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
        });

        it("differs for different tokens and never equals the plaintext", () => {
            expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
            const t = generateInviteToken();
            expect(hashInviteToken(t)).not.toBe(t);
        });
    });

    describe("tokenPrefix", () => {
        it("returns the first INVITE_TOKEN_PREFIX_LEN chars", () => {
            const t = generateInviteToken();
            expect(tokenPrefix(t)).toBe(t.slice(0, INVITE_TOKEN_PREFIX_LEN));
            expect(tokenPrefix(t)).toHaveLength(INVITE_TOKEN_PREFIX_LEN);
        });
    });

    describe("evaluateInvite", () => {
        const base: InviteState = {
            revokedAt: null,
            expiresAt: new Date("2030-01-01T00:00:00Z"),
            maxUses: 10,
            usedCount: 0,
        };
        const now = new Date("2026-01-01T00:00:00Z");

        it("accepts a fresh, un-revoked, non-expired invite with uses left", () => {
            expect(evaluateInvite(base, now)).toEqual({ ok: true });
        });

        it("rejects a revoked invite (revoked wins over everything)", () => {
            const inv = { ...base, revokedAt: new Date("2025-06-01T00:00:00Z"), usedCount: 999, expiresAt: new Date("2000-01-01") };
            expect(evaluateInvite(inv, now)).toEqual({ ok: false, reason: "REVOKED" });
        });

        it("rejects an expired invite", () => {
            const inv = { ...base, expiresAt: new Date("2025-12-31T23:59:59Z") };
            expect(evaluateInvite(inv, now)).toEqual({ ok: false, reason: "EXPIRED" });
        });

        it("treats the exact expiry instant as expired (<=)", () => {
            const inv = { ...base, expiresAt: now };
            expect(evaluateInvite(inv, now)).toEqual({ ok: false, reason: "EXPIRED" });
        });

        it("rejects an exhausted invite (usedCount >= maxUses)", () => {
            expect(evaluateInvite({ ...base, maxUses: 3, usedCount: 3 }, now)).toEqual({ ok: false, reason: "EXHAUSTED" });
            expect(evaluateInvite({ ...base, maxUses: 3, usedCount: 4 }, now)).toEqual({ ok: false, reason: "EXHAUSTED" });
        });

        it("allows the last remaining use (usedCount = maxUses - 1)", () => {
            expect(evaluateInvite({ ...base, maxUses: 3, usedCount: 2 }, now)).toEqual({ ok: true });
        });
    });

    describe("inviteInvalidMessage", () => {
        it("returns a distinct Spanish message per reason", () => {
            const msgs = [
                inviteInvalidMessage("REVOKED"),
                inviteInvalidMessage("EXPIRED"),
                inviteInvalidMessage("EXHAUSTED"),
            ];
            expect(new Set(msgs).size).toBe(3);
            for (const m of msgs) expect(m.length).toBeGreaterThan(0);
        });
    });
});
