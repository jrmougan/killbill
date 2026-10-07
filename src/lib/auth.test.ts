// @vitest-environment node
// Real jose signing (cross-realm Uint8Array checks fail under jsdom).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

let cookieValue: string | undefined;
const mockFindUser = vi.fn();

vi.mock("next/headers", () => ({
    cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));
vi.mock("./db", () => ({
    prisma: { user: { findUnique: (...a: unknown[]) => mockFindUser(...a) } },
}));

import { getSession, signToken, signGuestToken, signInternalMcpToken } from "./auth";

/** A token as minted BEFORE the `tv` claim existed (pre-deploy session). */
async function legacyToken(payload: Record<string, unknown>) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

describe("getSession token revocation", () => {
    beforeAll(() => {
        process.env.JWT_SECRET = "test-secret-for-vitest";
    });
    beforeEach(() => {
        cookieValue = undefined;
        mockFindUser.mockReset();
        mockFindUser.mockResolvedValue({ tokenVersion: 0 });
    });

    it("returns null without a cookie (no DB hit)", async () => {
        expect(await getSession()).toBeNull();
        expect(mockFindUser).not.toHaveBeenCalled();
    });

    it("accepts a session whose tv matches User.tokenVersion", async () => {
        cookieValue = await signToken({ userId: "u1", tv: 2 });
        mockFindUser.mockResolvedValue({ tokenVersion: 2 });
        expect((await getSession())?.userId).toBe("u1");
        expect(mockFindUser).toHaveBeenCalledWith({ where: { id: "u1" }, select: { tokenVersion: true } });
    });

    it("rejects a session after the user's tokens were revoked (tv mismatch)", async () => {
        cookieValue = await signToken({ userId: "u1", tv: 0 });
        mockFindUser.mockResolvedValue({ tokenVersion: 1 });
        expect(await getSession()).toBeNull();
    });

    it("accepts a legacy token without tv while the user is at version 0", async () => {
        cookieValue = await legacyToken({ userId: "u1", email: "a@b.c", isAdmin: false });
        expect((await getSession())?.userId).toBe("u1");
    });

    it("rejects a legacy token once the user bumped their version", async () => {
        cookieValue = await legacyToken({ userId: "u1" });
        mockFindUser.mockResolvedValue({ tokenVersion: 1 });
        expect(await getSession()).toBeNull();
    });

    it("rejects the session of a deleted user", async () => {
        cookieValue = await signToken({ userId: "gone", tv: 0 });
        mockFindUser.mockResolvedValue(null);
        expect(await getSession()).toBeNull();
    });

    it("checks MCP tokens forwarded as cookie too", async () => {
        cookieValue = await signInternalMcpToken({ userId: "u1", tv: 0, tid: "tok1" });
        mockFindUser.mockResolvedValue({ tokenVersion: 3 });
        expect(await getSession()).toBeNull();
    });

    it("accepts the internal per-request MCP JWT (with tid) while tv is current", async () => {
        cookieValue = await signInternalMcpToken({ userId: "u1", tv: 0, tid: "tok1" });
        expect((await getSession())?.kind).toBe("mcp");
    });

    it("rejects a legacy 90-day MCP JWT (no tid) as a cookie even with a current tv", async () => {
        cookieValue = await legacyToken({ userId: "u1", kind: "mcp", tv: 0 });
        expect(await getSession()).toBeNull();
        expect(mockFindUser).not.toHaveBeenCalled();
    });

    it("leaves guest sessions to getSessionCtx's membership revalidation (no tv lookup)", async () => {
        cookieValue = await signGuestToken({ userId: "g1", groupId: "s1", role: "GUEST" });
        expect((await getSession())?.kind).toBe("guest");
        expect(mockFindUser).not.toHaveBeenCalled();
    });
});
