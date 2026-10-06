import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockBump = vi.fn();
const mockDeleteCookie = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/token-version", () => ({ bumpTokenVersion: (...a: unknown[]) => mockBump(...a) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: (...a: unknown[]) => mockDeleteCookie(...a) }) }));

import { POST } from "./route";

describe("POST /api/me/sessions/revoke", () => {
    beforeEach(() => {
        mockGetSessionCtx.mockReset();
        mockBump.mockReset();
        mockDeleteCookie.mockReset();
        mockGetSessionCtx.mockResolvedValue({ userId: "u1", isAdmin: false });
        mockBump.mockResolvedValue(1);
    });

    it("401 without a session", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await POST(new Request("http://localhost/api/me/sessions/revoke", { method: "POST" }))).status).toBe(401);
        expect(mockBump).not.toHaveBeenCalled();
    });

    it.each(["guest", "mcp"])("403 for a %s session", async (kind) => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1", kind });
        expect((await POST(new Request("http://localhost/api/me/sessions/revoke", { method: "POST" }))).status).toBe(403);
        expect(mockBump).not.toHaveBeenCalled();
    });

    it("bumps the token version and clears the current cookie", async () => {
        const res = await POST(new Request("http://localhost/api/me/sessions/revoke", { method: "POST" }));
        expect(res.status).toBe(200);
        expect(mockBump).toHaveBeenCalledWith("u1");
        expect(mockDeleteCookie).toHaveBeenCalledWith("session_token");
    });

    it("500 (cookie kept) when the bump fails", async () => {
        mockBump.mockRejectedValue(new Error("db down"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await POST(new Request("http://localhost/api/me/sessions/revoke", { method: "POST" }))).status).toBe(500);
        expect(mockDeleteCookie).not.toHaveBeenCalled();
    });
});
