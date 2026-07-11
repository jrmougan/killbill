import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma singleton. $transaction only needs the array form here (reorder);
// the list→expense bridge (and its finance primitives) was removed.
const { mList, mItem, mTransaction } = vi.hoisted(() => {
    const mList = {
        findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(),
        create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(),
    };
    const mItem = {
        findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(),
        create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
    };
    const mTransaction = vi.fn((arg: unknown) => Promise.all(arg as Promise<unknown>[]));
    return { mList, mItem, mTransaction };
});

vi.mock("./db", () => ({
    prisma: {
        shoppingList: mList,
        shoppingListItem: mItem,
        $transaction: (a: unknown) => mTransaction(a),
    },
}));

import {
    createListForScope,
    updateListForScope,
    deleteListForScope,
    reorderListsForScope,
    createItemForScope,
    updateItemForScope,
    setItemChecked,
    deleteItemForScope,
    reorderItemsForScope,
    clearCheckedForScope,
    ListError,
    type ListWriteScope,
} from "./list-crud";

const GROUP: ListWriteScope = { kind: "group", groupId: "g1" };
const OWNER: ListWriteScope = { kind: "owner", ownerId: "u1" };

const groupList = { id: "l1", name: "Mercadona", groupId: "g1", ownerId: null };

async function expectError(fn: () => Promise<unknown>): Promise<ListError> {
    try {
        await fn();
    } catch (e) {
        expect(e).toBeInstanceOf(ListError);
        return e as ListError;
    }
    throw new Error("expected ListError, none thrown");
}

beforeEach(() => {
    [mList.findUnique, mList.findMany, mList.aggregate, mList.create, mList.update, mList.deleteMany,
     mItem.findUnique, mItem.findMany, mItem.aggregate, mItem.create, mItem.update, mItem.updateMany, mItem.deleteMany,
     mTransaction]
        .forEach((m) => m.mockReset());
    mTransaction.mockImplementation((arg: unknown) => Promise.all(arg as Promise<unknown>[]));
});

describe("createListForScope", () => {
    it("creates a group list (sortOrder=max+1, scoped by groupId, createdById set)", async () => {
        mList.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
        mList.create.mockResolvedValue({ id: "new" });
        await createListForScope(GROUP, { name: "  Lidl  ", description: "semanal" }, "u9");
        const data = mList.create.mock.calls[0][0].data;
        expect(data.name).toBe("Lidl");
        expect(data.description).toBe("semanal");
        expect(data.sortOrder).toBe(5);
        expect(data.groupId).toBe("g1");
        expect(data.ownerId).toBeNull();
        expect(data.createdById).toBe("u9");
    });

    it("creates a personal list scoped by ownerId (first → sortOrder 1, empty description → null)", async () => {
        mList.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
        mList.create.mockResolvedValue({ id: "np" });
        await createListForScope(OWNER, { name: "Casa", description: "   " }, "u1");
        const data = mList.create.mock.calls[0][0].data;
        expect(data.ownerId).toBe("u1");
        expect(data.groupId).toBeNull();
        expect(data.sortOrder).toBe(1);
        expect(data.description).toBeNull();
    });

    it("rejects an empty name with 400", async () => {
        const err = await expectError(() => createListForScope(GROUP, { name: "   " }, "u1"));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_NAME");
        expect(mList.create).not.toHaveBeenCalled();
    });
});

describe("updateListForScope — scope enforcement", () => {
    it("404s when the list does not exist", async () => {
        mList.findUnique.mockResolvedValue(null);
        const err = await expectError(() => updateListForScope(GROUP, "ghost", { name: "X" }));
        expect(err.status).toBe(404);
        expect(err.code).toBe("LIST_NOT_FOUND");
    });

    it("403s when the list belongs to another scope", async () => {
        mList.findUnique.mockResolvedValue({ ...groupList, groupId: "other" });
        const err = await expectError(() => updateListForScope(GROUP, "l1", { name: "X" }));
        expect(err.status).toBe(403);
        expect(err.code).toBe("LIST_OUT_OF_SCOPE");
    });

    it("updates name of an in-scope list", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mList.update.mockResolvedValue({ id: "l1" });
        await updateListForScope(GROUP, "l1", { name: "Consum" });
        expect(mList.update.mock.calls[0][0].data.name).toBe("Consum");
    });
});

describe("deleteListForScope — idempotent", () => {
    it("404s when nothing was deleted", async () => {
        mList.deleteMany.mockResolvedValue({ count: 0 });
        const err = await expectError(() => deleteListForScope(GROUP, "l1"));
        expect(err.status).toBe(404);
    });
    it("deletes an in-scope list (scoped deleteMany)", async () => {
        mList.deleteMany.mockResolvedValue({ count: 1 });
        const res = await deleteListForScope(GROUP, "l1");
        expect(res).toEqual({ deleted: "l1" });
        expect(mList.deleteMany).toHaveBeenCalledWith({ where: { id: "l1", groupId: "g1" } });
    });
});

describe("createItemForScope", () => {
    it("adds an item (sortOrder=max+1, only name required; no price field)", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
        mItem.create.mockResolvedValue({ id: "i1" });
        await createItemForScope(GROUP, "l1", { name: "pilas" });
        const data = mItem.create.mock.calls[0][0].data;
        expect(data.listId).toBe("l1");
        expect(data.name).toBe("pilas");
        expect(data.sortOrder).toBe(3);
        expect(data.quantity).toBeNull();
        expect("priceCents" in data).toBe(false);
        // "pilas" matches no aisle keyword → null (auto-assign never forces "otros").
        expect(data.aisle).toBeNull();
    });

    it("auto-assigns an aisle from the name", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
        mItem.create.mockResolvedValue({ id: "i2" });
        await createItemForScope(GROUP, "l1", { name: "Leche entera" });
        expect(mItem.create.mock.calls[0][0].data.aisle).toBe("lacteos");
    });

    it("honours an explicit valid aisle over auto-assign", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
        mItem.create.mockResolvedValue({ id: "i3" });
        await createItemForScope(GROUP, "l1", { name: "Leche", aisle: "otros" });
        expect(mItem.create.mock.calls[0][0].data.aisle).toBe("otros");
    });

    it("rejects an invalid aisle with 400", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        const err = await expectError(() => createItemForScope(GROUP, "l1", { name: "x", aisle: "nope" }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_AISLE");
    });

    it("rejects a non-integer quantity with 400", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        const err = await expectError(() => createItemForScope(GROUP, "l1", { name: "leche", quantity: 1.5 }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_QUANTITY");
    });
});

describe("updateItemForScope — field edit", () => {
    it("updates editable fields of an in-scope item (name/quantity/unit/aisle)", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue({ id: "i1", listId: "l1" });
        mItem.update.mockResolvedValue({ id: "i1" });
        await updateItemForScope(GROUP, "l1", "i1", { name: "pan", quantity: 2, unit: "ud", aisle: "panaderia" });
        const data = mItem.update.mock.calls[0][0].data;
        expect(data.name).toBe("pan");
        expect(data.quantity).toBe(2);
        expect(data.unit).toBe("ud");
        expect(data.aisle).toBe("panaderia");
        expect("priceCents" in data).toBe(false);
    });

    it("clears the aisle when passed empty", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue({ id: "i1", listId: "l1" });
        mItem.update.mockResolvedValue({ id: "i1" });
        await updateItemForScope(GROUP, "l1", "i1", { aisle: "" });
        expect(mItem.update.mock.calls[0][0].data.aisle).toBeNull();
    });

    it("400s when there is nothing to update", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue({ id: "i1", listId: "l1" });
        const err = await expectError(() => updateItemForScope(GROUP, "l1", "i1", {}));
        expect(err.status).toBe(400);
        expect(err.code).toBe("NOTHING_TO_UPDATE");
    });
});

describe("setItemChecked — idempotent toggle", () => {
    const item = { id: "i1", listId: "l1" };
    it("marks checked with a condition-by-id updateMany (never read-modify-write)", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue(item);
        mItem.updateMany.mockResolvedValue({ count: 1 });
        const res = await setItemChecked(GROUP, "l1", "i1", true, "u5");
        expect(res).toEqual({ changed: true, checked: true });
        const call = mItem.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: "i1", listId: "l1", checked: false });
        expect(call.data.checked).toBe(true);
        expect(call.data.checkedById).toBe("u5");
        expect(call.data.checkedAt).toBeInstanceOf(Date);
    });

    it("is a no-op (changed:false) when already in the desired state", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue(item);
        mItem.updateMany.mockResolvedValue({ count: 0 });
        const res = await setItemChecked(GROUP, "l1", "i1", true, "u5");
        expect(res).toEqual({ changed: false, checked: true });
    });

    it("clears audit fields when unchecking", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue(item);
        mItem.updateMany.mockResolvedValue({ count: 1 });
        await setItemChecked(GROUP, "l1", "i1", false, "u5");
        const call = mItem.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: "i1", listId: "l1", checked: true });
        expect(call.data).toEqual({ checked: false, checkedById: null, checkedAt: null });
    });

    it("404s when the item is not in the list", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue({ id: "i1", listId: "other" });
        const err = await expectError(() => setItemChecked(GROUP, "l1", "i1", true, "u5"));
        expect(err.status).toBe(404);
        expect(err.code).toBe("ITEM_NOT_FOUND");
    });
});

describe("clearCheckedForScope — vaciar comprados", () => {
    it("deletes the checked items of an in-scope list and returns the count", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.deleteMany.mockResolvedValue({ count: 3 });
        const res = await clearCheckedForScope(GROUP, "l1");
        expect(res).toEqual({ cleared: 3 });
        expect(mItem.deleteMany).toHaveBeenCalledWith({ where: { listId: "l1", checked: true } });
    });

    it("is idempotent (cleared:0 when nothing was checked)", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.deleteMany.mockResolvedValue({ count: 0 });
        const res = await clearCheckedForScope(GROUP, "l1");
        expect(res).toEqual({ cleared: 0 });
    });

    it("403s when the list belongs to another scope (no delete)", async () => {
        mList.findUnique.mockResolvedValue({ ...groupList, groupId: "other" });
        const err = await expectError(() => clearCheckedForScope(GROUP, "l1"));
        expect(err.status).toBe(403);
        expect(mItem.deleteMany).not.toHaveBeenCalled();
    });
});

describe("deleteItemForScope — idempotent", () => {
    it("404s when nothing was deleted", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.deleteMany.mockResolvedValue({ count: 0 });
        const err = await expectError(() => deleteItemForScope(GROUP, "l1", "i1"));
        expect(err.status).toBe(404);
    });
});

describe("reorderItemsForScope", () => {
    it("rejects an order that doesn't match the list's items", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
        const err = await expectError(() => reorderItemsForScope(GROUP, "l1", ["a"]));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_ORDER");
    });

    it("writes sortOrder 1..n in the given order", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
        mItem.update.mockResolvedValue({});
        const res = await reorderItemsForScope(GROUP, "l1", ["b", "a"]);
        expect(res).toEqual({ reordered: 2 });
        expect(mItem.update).toHaveBeenNthCalledWith(1, { where: { id: "b" }, data: { sortOrder: 1 } });
        expect(mItem.update).toHaveBeenNthCalledWith(2, { where: { id: "a" }, data: { sortOrder: 2 } });
    });
});

describe("reorderListsForScope", () => {
    it("writes sortOrder 1..n across the scope's lists", async () => {
        mList.findMany.mockResolvedValue([{ id: "x" }, { id: "y" }]);
        mList.update.mockResolvedValue({});
        const res = await reorderListsForScope(GROUP, ["y", "x"]);
        expect(res).toEqual({ reordered: 2 });
        expect(mList.update).toHaveBeenNthCalledWith(1, { where: { id: "y" }, data: { sortOrder: 1 } });
    });
});
