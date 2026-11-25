import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionCtx = vi.fn();
const requireSpaceAccess = vi.fn();
const createListForScope = vi.fn();
const reorderListsForScope = vi.fn();
const createItemForScope = vi.fn();
const setItemChecked = vi.fn();
const updateItemForScope = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => getSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => requireSpaceAccess(...a),
}));
vi.mock("@/lib/list-read", () => ({ getListsForScope: vi.fn(async () => []), getListWithItems: vi.fn() }));
vi.mock("@/lib/list-crud", async () => {
    const actual = await vi.importActual<typeof import("@/lib/list-crud")>("@/lib/list-crud");
    return {
        ListError: actual.ListError,
        createListForScope: (...a: unknown[]) => createListForScope(...a),
        reorderListsForScope: (...a: unknown[]) => reorderListsForScope(...a),
        createItemForScope: (...a: unknown[]) => createItemForScope(...a),
        setItemChecked: (...a: unknown[]) => setItemChecked(...a),
        updateItemForScope: (...a: unknown[]) => updateItemForScope(...a),
        deleteItemForScope: vi.fn(),
    };
});

import { ListError } from "@/lib/list-crud";
import { POST, PATCH } from "./route";
import { POST as POST_ITEM } from "./[listId]/items/route";
import { PATCH as PATCH_ITEM } from "./[listId]/items/[itemId]/route";

const listParams = { params: Promise.resolve({ id: "g1" }) };
const itemsParams = { params: Promise.resolve({ id: "g1", listId: "l1" }) };
const itemParams = { params: Promise.resolve({ id: "g1", listId: "l1", itemId: "i1" }) };

const req = (body: string, method = "POST") => new Request("http://x", { method, body });

function space(status: string) {
    requireSpaceAccess.mockResolvedValue({ ok: true, userId: "u1", space: { id: "g1", status } });
}

beforeEach(() => {
    vi.clearAllMocks();
    getSessionCtx.mockResolvedValue({ userId: "u1" });
    space("ACTIVE");
    createListForScope.mockImplementation(async (_s, body: { name: string }) => ({ id: "l1", name: body.name }));
    createItemForScope.mockImplementation(async (_s, _l, body: { name: string }) => ({ id: "i1", name: body.name }));
});

describe("space list writes (route() kit)", () => {
    it("POST creates a list as the caller, gated with allowArchived", async () => {
        const res = await POST(req(JSON.stringify({ name: "Súper", extra: 1 })), listParams);
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ list: { id: "l1", name: "Súper" } });
        expect(requireSpaceAccess).toHaveBeenCalledWith({ userId: "u1" }, "g1", { allowArchived: true });
        // Unknown keys are stripped before reaching the lib.
        expect(createListForScope).toHaveBeenCalledWith({ kind: "group", groupId: "g1" }, { name: "Súper" }, "u1");
    });

    it("SETTLING still allows list writes; ARCHIVED → 409 SPACE_NOT_WRITABLE", async () => {
        space("SETTLING");
        expect((await POST(req(JSON.stringify({ name: "A" })), listParams)).status).toBe(201);
        space("ARCHIVED");
        const res = await POST(req(JSON.stringify({ name: "A" })), listParams);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: "Este espacio está archivado: sus listas son de solo lectura",
            code: "SPACE_NOT_WRITABLE",
        });
    });

    it.each([["{"], ["null"], ["[]"], [""]])("400 'Petición no válida' for the body %j (was a 500)", async (body) => {
        const res = await POST_ITEM(req(body), itemsParams);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("Petición no válida");
        expect(createItemForScope).not.toHaveBeenCalled();
    });

    it("a stranger gets the space denial before any body validation", async () => {
        requireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No perteneces a este espacio" });
        const res = await POST_ITEM(req("{"), itemsParams);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "No perteneces a este espacio" });
    });

    it("a ListError keeps its status + machine code", async () => {
        createItemForScope.mockRejectedValue(new ListError(400, "INVALID_QUANTITY", "Cantidad no válida"));
        const res = await POST_ITEM(req(JSON.stringify({ name: "Leche", quantity: "x" })), itemsParams);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Cantidad no válida", code: "INVALID_QUANTITY" });
    });

    it("an unexpected error is a 500 'Error en las listas'", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        createItemForScope.mockRejectedValue(new Error("boom"));
        const res = await POST_ITEM(req(JSON.stringify({ name: "Leche" })), itemsParams);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error en las listas" });
        spy.mockRestore();
    });

    it("PATCH reorder passes `order` through to the lib (which owns INVALID_ORDER)", async () => {
        reorderListsForScope.mockResolvedValue({ reordered: 2 });
        const res = await PATCH(req(JSON.stringify({ order: ["a", "b"] }), "PATCH"), listParams);
        expect(res.status).toBe(200);
        expect(reorderListsForScope).toHaveBeenCalledWith({ kind: "group", groupId: "g1" }, ["a", "b"]);
    });

    it("PATCH item: boolean `checked` toggles as the caller, anything else edits", async () => {
        setItemChecked.mockResolvedValue({ changed: true, checked: true });
        const toggled = await PATCH_ITEM(req(JSON.stringify({ checked: true }), "PATCH"), itemParams);
        expect(await toggled.json()).toEqual({ changed: true, checked: true });
        expect(setItemChecked).toHaveBeenCalledWith({ kind: "group", groupId: "g1" }, "l1", "i1", true, "u1");

        updateItemForScope.mockResolvedValue({ id: "i1", name: "Pan" });
        const edited = await PATCH_ITEM(req(JSON.stringify({ checked: "yes", name: "Pan" }), "PATCH"), itemParams);
        expect(await edited.json()).toEqual({ item: { id: "i1", name: "Pan" } });
        expect(updateItemForScope).toHaveBeenCalledTimes(1);
    });
});
