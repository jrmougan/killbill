import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockGetMembership = vi.fn();
const mockGetActiveGroup = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/membership", () => ({
    getMembership: (...a: unknown[]) => mockGetMembership(...a),
    getActiveGroup: (...a: unknown[]) => mockGetActiveGroup(...a),
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (...a: unknown[]) => mockTransaction(...a) } }));

import { POST } from "./route";

const call = (body?: string) => POST(new Request("http://x", { method: "POST", ...(body !== undefined ? { body } : {}) }));

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    mockGetActiveGroup.mockResolvedValue("active");
    mockGetMembership.mockResolvedValue({ status: "ACTIVE" });
    mockTransaction.mockResolvedValue(undefined);
});

describe("POST /api/couple/unlink", () => {
    it("401 without a session, 403 for a guest", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await call()).status).toBe(401);
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        expect((await call()).status).toBe(403);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it.each([[undefined], ["{"], ["null"], ["[1]"], [JSON.stringify({ groupId: 7 })]])(
        "falls back to the active group for body %s (lenient, never a 400)",
        async (body) => {
            expect((await call(body)).status).toBe(200);
            expect(mockGetMembership).not.toHaveBeenCalled();
            expect(mockGetActiveGroup).toHaveBeenCalledWith("u1");
        },
    );

    it("leaves an explicit group only with an ACTIVE membership", async () => {
        mockGetMembership.mockResolvedValue({ status: "LEFT" });
        const res = await call(JSON.stringify({ groupId: "g9" }));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "No perteneces a este grupo" });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("400 when there is no group to leave; 500 with the historical message on failure", async () => {
        mockGetActiveGroup.mockResolvedValue(null);
        expect(await (await call()).json()).toEqual({ error: "No estás en ningún grupo" });
        mockGetActiveGroup.mockResolvedValue("active");
        mockTransaction.mockRejectedValue(new Error("db"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call();
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe("No se pudo salir del espacio. Inténtalo de nuevo.");
    });
});
