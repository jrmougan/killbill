import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCtx = vi.fn();
const requireSpaceAccess = vi.fn();

vi.mock("./authz", () => ({
    getSessionCtx: () => getSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => requireSpaceAccess(...a),
}));
vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => getSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => requireSpaceAccess(...a),
}));

import { listErrorResponse, requireListWriteAccess } from "./list-http";
import { ListError } from "./list-crud";

beforeEach(() => {
    vi.clearAllMocks();
    getSessionCtx.mockResolvedValue({ userId: "u1" });
});

describe("listErrorResponse (backward-compatible API)", () => {
    it("maps a ListError to { error, code } with its status", async () => {
        const res = listErrorResponse(new ListError(404, "LIST_NOT_FOUND", "Lista no encontrada"));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" });
    });

    it("anything else → 500 'Error en las listas'", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = listErrorResponse(new TypeError("x"));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error en las listas" });
        expect(spy).toHaveBeenCalledWith("Shopping list error:", expect.any(TypeError));
        spy.mockRestore();
    });
});

describe("requireListWriteAccess (backward-compatible API)", () => {
    it("ok with the access for an ACTIVE/SETTLING space", async () => {
        const auth = { ok: true, userId: "u1", space: { status: "SETTLING" } };
        requireSpaceAccess.mockResolvedValue(auth);
        expect(await requireListWriteAccess("g1")).toEqual({ ok: true, auth });
        expect(requireSpaceAccess).toHaveBeenCalledWith({ userId: "u1" }, "g1", { allowArchived: true });
    });

    it("409 SPACE_NOT_WRITABLE response for an ARCHIVED space", async () => {
        requireSpaceAccess.mockResolvedValue({ ok: true, userId: "u1", space: { status: "ARCHIVED" } });
        const gate = await requireListWriteAccess("g1");
        expect(gate.ok).toBe(false);
        if (gate.ok) return;
        expect(gate.response.status).toBe(409);
        expect(await gate.response.json()).toMatchObject({ code: "SPACE_NOT_WRITABLE" });
    });

    it("the denial response for a non-member", async () => {
        requireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No perteneces a este espacio" });
        const gate = await requireListWriteAccess("g1");
        if (gate.ok) throw new Error("expected a denial");
        expect(gate.response.status).toBe(403);
        expect(await gate.response.json()).toEqual({ error: "No perteneces a este espacio" });
    });
});
