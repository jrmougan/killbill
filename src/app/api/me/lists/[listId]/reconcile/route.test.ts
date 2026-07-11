import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRunReconcile = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: (...a: unknown[]) => mockGetSessionCtx(...a) }));
vi.mock("@/lib/reconcile-handler", () => ({ runReconcile: (...a: unknown[]) => mockRunReconcile(...a) }));

import { POST } from "./route";

const params = Promise.resolve({ listId: "l1" });
const req = () => new Request("http://localhost/api/me/lists/l1/reconcile", { method: "POST" });

describe("POST /api/me/lists/[listId]/reconcile — authorization", () => {
    beforeEach(() => {
        [mockGetSessionCtx, mockRunReconcile].forEach((m) => m.mockReset());
    });

    it("denies an unauthenticated caller (401) and never runs the paid reconcile", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await POST(req(), { params });
        expect(res.status).toBe(401);
        expect(mockRunReconcile).not.toHaveBeenCalled();
    });

    it("delegates to runReconcile in the OWNER scope for the caller", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockRunReconcile.mockResolvedValue(new Response(null, { status: 200 }));
        const res = await POST(req(), { params });
        expect(res.status).toBe(200);
        const [, scope, listId, userId] = mockRunReconcile.mock.calls[0];
        expect(scope).toEqual({ kind: "owner", ownerId: "u1" });
        expect(listId).toBe("l1");
        expect(userId).toBe("u1");
    });
});
