import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockCreateList = vi.fn();
const mockReorderLists = vi.fn();
const mockSetChecked = vi.fn();
const mockUpdateItem = vi.fn();
const mockCreateItem = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/list-read", () => ({ getListsForScope: async () => [], getListWithItems: async () => null }));
vi.mock("@/lib/list-crud", () => {
    class ListError extends Error {
        constructor(public status: number, public code: string, message: string) {
            super(message);
            this.name = "ListError";
        }
    }
    return {
        ListError,
        createListForScope: (...a: unknown[]) => mockCreateList(...a),
        reorderListsForScope: (...a: unknown[]) => mockReorderLists(...a),
        setItemChecked: (...a: unknown[]) => mockSetChecked(...a),
        updateItemForScope: (...a: unknown[]) => mockUpdateItem(...a),
        createItemForScope: (...a: unknown[]) => mockCreateItem(...a),
        deleteItemForScope: vi.fn(),
    };
});

import { GET, POST, PATCH } from "./route";
import { PATCH as PATCH_ITEM } from "./[listId]/items/[itemId]/route";
import { GET as GET_ITEMS, POST as POST_ITEM } from "./[listId]/items/route";
import { ListError } from "@/lib/list-crud";

const URL = "http://localhost/api/me/lists";
const send = (method: string, body: unknown, url = URL) =>
    new Request(url, { method, body: typeof body === "string" ? body : JSON.stringify(body) });
const scope = { kind: "owner", ownerId: "u1" };
const itemCtx = { params: Promise.resolve({ listId: "l1", itemId: "i1" }) };
const listCtx = { params: Promise.resolve({ listId: "l1" }) };

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    mockCreateList.mockResolvedValue({ id: "l1" });
    mockReorderLists.mockResolvedValue({ reordered: 0 });
    mockSetChecked.mockResolvedValue({ changed: true, checked: true });
    mockUpdateItem.mockResolvedValue({ id: "i1" });
    mockCreateItem.mockResolvedValue({ id: "i1" });
});

describe("/api/me/lists/**", () => {
    it("401 'Unauthorized' without a session, 403 for a guest", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await GET(new Request(URL));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        const guest = await POST(send("POST", { name: "x" }));
        expect(guest.status).toBe(403);
        expect(await guest.json()).toEqual({ error: "Acción no permitida para invitados" });
        expect(mockCreateList).not.toHaveBeenCalled();
    });

    it("POST forwards the body to the owner scope; ListError keeps status + code", async () => {
        expect((await POST(send("POST", { name: "Súper" }))).status).toBe(201);
        expect(mockCreateList).toHaveBeenCalledWith(scope, { name: "Súper" }, "u1");
        mockCreateList.mockRejectedValueOnce(new ListError(400, "INVALID_NAME", "El nombre es obligatorio"));
        const res = await POST(send("POST", { name: "" }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "El nombre es obligatorio", code: "INVALID_NAME" });
    });

    it("400 'Petición no válida' (was a 500) on an unparseable or non-object body", async () => {
        for (const body of ["{", "[1]", "null"]) {
            const res = await POST(send("POST", body));
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe("Petición no válida");
        }
        expect((await PATCH(send("PATCH", "{"))).status).toBe(400);
        expect((await POST_ITEM(send("POST", "{"), listCtx)).status).toBe(400);
        expect(mockCreateList).not.toHaveBeenCalled();
        expect(mockCreateItem).not.toHaveBeenCalled();
    });

    it("item PATCH: a boolean `checked` toggles, anything else edits", async () => {
        await PATCH_ITEM(send("PATCH", { checked: true }), itemCtx);
        expect(mockSetChecked).toHaveBeenCalledWith(scope, "l1", "i1", true, "u1");
        await PATCH_ITEM(send("PATCH", { name: "Pan", quantity: "1,5" }), itemCtx);
        expect(mockUpdateItem).toHaveBeenCalledWith(scope, "l1", "i1", { name: "Pan", quantity: "1,5" });
    });

    it("GET items 404 LIST_NOT_FOUND for a missing/foreign list", async () => {
        const res = await GET_ITEMS(new Request(`${URL}/l1/items`), listCtx);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" });
    });
});
