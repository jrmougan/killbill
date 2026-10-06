import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockReorder = vi.fn();
const mockDelete = vi.fn();
const mockDuplicate = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/category-db", () => ({ getEffectiveCategories: async () => [{ id: "s", isSystem: true }, { id: "c", isSystem: false }] }));
vi.mock("@/lib/category-crud", async () => {
    // Keep the real CategoryError (route() maps it by name), mock the writes.
    class CategoryError extends Error {
        constructor(public status: number, public code: string, message: string) {
            super(message);
            this.name = "CategoryError";
        }
    }
    return {
        CategoryError,
        createCategoryForScope: (...a: unknown[]) => mockCreate(...a),
        updateCategoryForScope: (...a: unknown[]) => mockUpdate(...a),
        reorderCategoriesForScope: (...a: unknown[]) => mockReorder(...a),
        deleteCategoryForScope: (...a: unknown[]) => mockDelete(...a),
        duplicateCategoryForScope: (...a: unknown[]) => mockDuplicate(...a),
    };
});

import { GET, POST, PATCH, DELETE } from "./route";
import { POST as DUPLICATE } from "./duplicate/route";
import { CategoryError } from "@/lib/category-crud";

const URL = "http://localhost/api/me/categories";
const send = (method: string, body: unknown) =>
    new Request(URL, { method, body: typeof body === "string" ? body : JSON.stringify(body) });
const scope = { kind: "owner", ownerId: "u1" };

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    mockCreate.mockResolvedValue({ id: "c1" });
    mockUpdate.mockResolvedValue({ id: "c1" });
    mockReorder.mockResolvedValue({ reordered: 1 });
    mockDelete.mockResolvedValue({ deleted: "c1" });
    mockDuplicate.mockResolvedValue({ id: "c2" });
});

describe("/api/me/categories", () => {
    it("401 'Unauthorized' without a session", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await GET(new Request(URL));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("GET merges with an editable flag", async () => {
        const body = await (await GET(new Request(URL))).json();
        expect(body.categories.map((c: { editable: boolean }) => c.editable)).toEqual([false, true]);
    });

    it("POST forwards the body to the owner scope; CategoryError keeps status + code", async () => {
        const res = await POST(send("POST", { label: "Gym", hex: "#000000" }));
        expect(res.status).toBe(201);
        expect(mockCreate).toHaveBeenCalledWith(scope, { label: "Gym", hex: "#000000" });
        mockCreate.mockRejectedValueOnce(new CategoryError(400, "INVALID_COLOR", "Color no válido (fuera de la paleta)"));
        const bad = await POST(send("POST", { label: "Gym", hex: "red" }));
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: "Color no válido (fuera de la paleta)", code: "INVALID_COLOR" });
    });

    it("400 'Petición no válida' (was a 500) on an unparseable or non-object body", async () => {
        for (const body of ["{", "[1]", "null"]) {
            const res = await POST(send("POST", body));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe("Petición no válida");
        }
        expect((await PATCH(send("PATCH", "{"))).status).toBe(400);
        expect((await DUPLICATE(send("POST", "{"))).status).toBe(400);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("PATCH reorders with an order array, else needs an id", async () => {
        expect((await PATCH(send("PATCH", { order: ["a"] }))).status).toBe(200);
        expect(mockReorder).toHaveBeenCalledWith(scope, ["a"]);
        const res = await PATCH(send("PATCH", { label: "x" }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Falta el id de la categoría" });
        expect((await PATCH(send("PATCH", { id: "c1", label: "x" }))).status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledWith(scope, "c1", { id: "c1", label: "x" });
    });

    it("DELETE requires ?id and forwards reassignTo (null when absent)", async () => {
        const missing = await DELETE(new Request(`${URL}?reassignTo=x`, { method: "DELETE" }));
        expect(missing.status).toBe(400);
        expect((await missing.json()).error).toBe("Falta el id de la categoría");
        await DELETE(new Request(`${URL}?id=c1`, { method: "DELETE" }));
        expect(mockDelete).toHaveBeenLastCalledWith(scope, "c1", null);
        await DELETE(new Request(`${URL}?id=c1&reassignTo=c2`, { method: "DELETE" }));
        expect(mockDelete).toHaveBeenLastCalledWith(scope, "c1", "c2");
    });

    it("duplicate forwards sourceId; unexpected errors → 500 'Error en categorías'", async () => {
        expect((await DUPLICATE(send("POST", { sourceId: "s" }))).status).toBe(201);
        expect(mockDuplicate).toHaveBeenCalledWith(scope, "s");
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockDuplicate.mockRejectedValueOnce(new Error("db"));
        const res = await DUPLICATE(send("POST", { sourceId: "s" }));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error en categorías" });
    });
});
