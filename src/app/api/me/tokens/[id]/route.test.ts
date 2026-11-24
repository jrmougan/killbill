// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRevoke = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/access-tokens", () => ({
    revokeAccessToken: (...a: unknown[]) => mockRevoke(...a),
}));

import { DELETE } from "./route";

function del(id: string) {
    return DELETE(new Request(`http://localhost/api/me/tokens/${id}`, { method: "DELETE" }), {
        params: Promise.resolve({ id }),
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", isAdmin: false });
    mockRevoke.mockResolvedValue(true);
});

describe("DELETE /api/me/tokens/[id]", () => {
    it("returns 401 without a session", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await del("tok-1");
        expect(res.status).toBe(401);
        expect(mockRevoke).not.toHaveBeenCalled();
    });

    it.each(["guest", "mcp"])("returns 403 for a %s session", async (kind) => {
        mockGetSessionCtx.mockResolvedValue({ userId: "user-1", kind });
        const res = await del("tok-1");
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({ error: "Acción no permitida con este tipo de sesión" });
        expect(mockRevoke).not.toHaveBeenCalled();
    });

    it("revokes the caller's token", async () => {
        const res = await del("tok-1");
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        await expect(res.json()).resolves.toEqual({ success: true });
        expect(mockRevoke).toHaveBeenCalledWith("user-1", "tok-1");
    });

    it("returns 404 for a missing or foreign token", async () => {
        mockRevoke.mockResolvedValue(false);
        const res = await del("tok-other");
        expect(res.status).toBe(404);
        await expect(res.json()).resolves.toEqual({ error: "Token no encontrado" });
    });
});
