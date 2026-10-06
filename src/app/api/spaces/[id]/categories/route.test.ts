import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCtx = vi.fn();
const requireSpaceAccess = vi.fn();
const createCategoryForScope = vi.fn();
const updateCategoryForScope = vi.fn();
const reorderCategoriesForScope = vi.fn();
const deleteCategoryForScope = vi.fn();
const duplicateCategoryForScope = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => getSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => requireSpaceAccess(...a),
}));
vi.mock("@/lib/category-db", () => ({ getEffectiveCategories: vi.fn(async () => []) }));
vi.mock("@/lib/category-crud", () => {
    class CategoryError extends Error {
        constructor(public status: number, public code: string, message: string) {
            super(message);
            this.name = "CategoryError";
        }
    }
    return {
        CategoryError,
        createCategoryForScope: (...a: unknown[]) => createCategoryForScope(...a),
        updateCategoryForScope: (...a: unknown[]) => updateCategoryForScope(...a),
        reorderCategoriesForScope: (...a: unknown[]) => reorderCategoriesForScope(...a),
        deleteCategoryForScope: (...a: unknown[]) => deleteCategoryForScope(...a),
        duplicateCategoryForScope: (...a: unknown[]) => duplicateCategoryForScope(...a),
    };
});

import { CategoryError } from "@/lib/category-crud";
import { DELETE, GET, PATCH, POST } from "./route";
import { POST as DUPLICATE } from "./duplicate/route";

const ctx = { params: Promise.resolve({ id: "g1" }) };
const scope = { kind: "group", groupId: "g1" };
const req = (body: string, method = "POST", url = "http://x") => new Request(url, { method, body });

beforeEach(() => {
    vi.clearAllMocks();
    getSessionCtx.mockResolvedValue({ userId: "u1" });
    requireSpaceAccess.mockResolvedValue({ ok: true, userId: "u1", space: { id: "g1", status: "ACTIVE" } });
});

describe("/api/spaces/[id]/categories (route() kit)", () => {
    it("GET lets guests read, archived spaces included", async () => {
        getSessionCtx.mockResolvedValue({ userId: "g", kind: "guest", groupId: "g1" });
        const res = await GET(new Request("http://x"), ctx);
        expect(res.status).toBe(200);
        expect(requireSpaceAccess).toHaveBeenCalledWith(expect.anything(), "g1", { allowArchived: true, allowGuest: true });
    });

    it("POST is OWNER/ADMIN-gated and forwards the body", async () => {
        createCategoryForScope.mockResolvedValue({ id: "c1" });
        const res = await POST(req(JSON.stringify({ label: "Mascotas", hex: "#000" })), ctx);
        expect(res.status).toBe(201);
        expect(requireSpaceAccess).toHaveBeenCalledWith({ userId: "u1" }, "g1", { roles: ["OWNER", "ADMIN"] });
        expect(createCategoryForScope).toHaveBeenCalledWith(scope, { label: "Mascotas", hex: "#000" });
    });

    it.each([["{"], [""], ["null"]])("POST 400 'Petición no válida' for the body %j (was a 500)", async (body) => {
        const res = await POST(req(body), ctx);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("Petición no válida");
        expect(createCategoryForScope).not.toHaveBeenCalled();
    });

    it("a CategoryError keeps its status + code", async () => {
        createCategoryForScope.mockRejectedValue(new CategoryError(400, "INVALID_COLOR", "Color no válido (fuera de la paleta)"));
        const res = await POST(req(JSON.stringify({ hex: "#123456" })), ctx);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Color no válido (fuera de la paleta)", code: "INVALID_COLOR" });
    });

    it("PATCH: `order` array → reorder; no id → 400; id → update", async () => {
        reorderCategoriesForScope.mockResolvedValue({ reordered: 1 });
        expect((await PATCH(req(JSON.stringify({ order: ["c1"] }), "PATCH"), ctx)).status).toBe(200);
        expect(reorderCategoriesForScope).toHaveBeenCalledWith(scope, ["c1"]);

        const missing = await PATCH(req(JSON.stringify({ label: "X" }), "PATCH"), ctx);
        expect(missing.status).toBe(400);
        expect((await missing.json()).error).toBe("Falta el id de la categoría");

        updateCategoryForScope.mockResolvedValue({ id: "c1" });
        expect((await PATCH(req(JSON.stringify({ id: "c1", label: "X" }), "PATCH"), ctx)).status).toBe(200);
        expect(updateCategoryForScope).toHaveBeenCalledWith(scope, "c1", { id: "c1", label: "X" });
    });

    it("DELETE reads id/reassignTo from the query", async () => {
        deleteCategoryForScope.mockResolvedValue({ deleted: "c1" });
        const res = await DELETE(new Request("http://x/?id=c1&reassignTo=c2", { method: "DELETE" }), ctx);
        expect(res.status).toBe(200);
        expect(deleteCategoryForScope).toHaveBeenCalledWith(scope, "c1", "c2");

        const noTarget = await DELETE(new Request("http://x/?id=c1", { method: "DELETE" }), ctx);
        expect(noTarget.status).toBe(200);
        expect(deleteCategoryForScope).toHaveBeenLastCalledWith(scope, "c1", null);

        const missing = await DELETE(new Request("http://x/", { method: "DELETE" }), ctx);
        expect(missing.status).toBe(400);
        expect((await missing.json()).error).toBe("Falta el id de la categoría");
    });

    it("a MEMBER is denied before any body parsing", async () => {
        requireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No tienes permisos para esta acción" });
        const res = await POST(req("{"), ctx);
        expect(res.status).toBe(403);
    });

    it("duplicate forwards sourceId and 400s on garbage JSON", async () => {
        duplicateCategoryForScope.mockResolvedValue({ id: "c9" });
        expect((await DUPLICATE(req(JSON.stringify({ sourceId: "food" })), ctx)).status).toBe(201);
        expect(duplicateCategoryForScope).toHaveBeenCalledWith(scope, "food");

        const bad = await DUPLICATE(req("{"), ctx);
        expect(bad.status).toBe(400);
        expect((await bad.json()).error).toBe("Petición no válida");
    });
});
