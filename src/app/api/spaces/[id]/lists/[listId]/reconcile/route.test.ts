import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockRunReconcile = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: (...a: unknown[]) => mockGetSessionCtx(...a),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock("@/lib/reconcile-handler", () => ({ runReconcile: (...a: unknown[]) => mockRunReconcile(...a) }));

import { POST } from "./route";

const params = Promise.resolve({ id: "g1", listId: "l1" });
const req = () => new Request("http://localhost/api/spaces/g1/lists/l1/reconcile", { method: "POST" });

describe("POST /api/spaces/[id]/lists/[listId]/reconcile — authorization", () => {
    beforeEach(() => {
        [mockGetSessionCtx, mockRequireSpaceAccess, mockRunReconcile].forEach((m) => m.mockReset());
    });

    it("denies a non-member (403) and never runs the paid reconcile", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u9" });
        mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No perteneces a este espacio" });
        const res = await POST(req(), { params });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "No perteneces a este espacio" });
        expect(mockRunReconcile).not.toHaveBeenCalled();
    });

    it("denies an unauthenticated caller (401)", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
        const res = await POST(req(), { params });
        expect(res.status).toBe(401);
        expect(mockRunReconcile).not.toHaveBeenCalled();
    });

    it("delegates to runReconcile in the GROUP scope for an authorized member", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockRequireSpaceAccess.mockResolvedValue({ ok: true, userId: "u1" });
        mockRunReconcile.mockResolvedValue(new Response(null, { status: 200 }));
        const res = await POST(req(), { params });
        expect(res.status).toBe(200);
        const [, scope, listId, userId] = mockRunReconcile.mock.calls[0];
        expect(scope).toEqual({ kind: "group", groupId: "g1" });
        expect(listId).toBe("l1");
        expect(userId).toBe("u1");
    });
});
