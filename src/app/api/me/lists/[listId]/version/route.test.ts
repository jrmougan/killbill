import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCtx = vi.fn();
const getListVersion = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => getSessionCtx() }));
vi.mock("@/lib/list-read", () => ({ getListVersion: (...a: unknown[]) => getListVersion(...a) }));

import { GET } from "./route";

const call = () => GET(new Request("http://x"), { params: Promise.resolve({ listId: "l1" }) });

beforeEach(() => {
    vi.clearAllMocks();
    getSessionCtx.mockResolvedValue({ userId: "u1" });
    getListVersion.mockResolvedValue("0.0.1");
});

describe("GET /api/me/lists/[listId]/version", () => {
    it("scopes the list to the session owner", async () => {
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ version: "0.0.1" });
        expect(getListVersion).toHaveBeenCalledWith({ kind: "owner", ownerId: "u1" }, "l1");
    });

    it("401 without a session, 403 for guests", async () => {
        getSessionCtx.mockResolvedValue(null);
        expect((await call()).status).toBe(401);
        getSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest" });
        expect((await call()).status).toBe(403);
        expect(getListVersion).not.toHaveBeenCalled();
    });

    it("404 for someone else's list", async () => {
        getListVersion.mockResolvedValue(null);
        expect((await call()).status).toBe(404);
    });
});
