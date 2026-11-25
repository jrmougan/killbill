import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCtx = vi.fn();
const requireSpaceAccess = vi.fn();
const getListVersion = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => getSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => requireSpaceAccess(...a),
}));
vi.mock("@/lib/list-read", () => ({ getListVersion: (...a: unknown[]) => getListVersion(...a) }));

import { GET } from "./route";

const call = () => GET(new Request("http://x"), { params: Promise.resolve({ id: "g1", listId: "l1" }) });

beforeEach(() => {
    vi.clearAllMocks();
    getSessionCtx.mockResolvedValue({ userId: "u1" });
    requireSpaceAccess.mockResolvedValue({ ok: true });
    getListVersion.mockResolvedValue("2.9.1");
});

describe("GET /api/spaces/[id]/lists/[listId]/version", () => {
    it("authorizes like the list reads: member of the resource's space, guests denied, archived readable", async () => {
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ version: "2.9.1" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(requireSpaceAccess).toHaveBeenCalledWith({ userId: "u1" }, "g1", { allowArchived: true });
        expect(getListVersion).toHaveBeenCalledWith({ kind: "group", groupId: "g1" }, "l1");
    });

    it("propagates the authorization denial without reading the list", async () => {
        requireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No perteneces a este espacio" });
        const res = await call();
        expect(res.status).toBe(403);
        expect(getListVersion).not.toHaveBeenCalled();
    });

    it("404 for a list outside the space", async () => {
        getListVersion.mockResolvedValue(null);
        const res = await call();
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "LIST_NOT_FOUND" });
    });
});
