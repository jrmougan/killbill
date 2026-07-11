import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma singleton + the finance primitives the bridge reuses. Defined
// via vi.hoisted so the vi.mock factories (hoisted above imports) can reference them.
const { mList, mItem, mExpense, mTransaction } = vi.hoisted(() => {
    const mList = {
        findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(),
        create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(),
    };
    const mItem = {
        findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(),
        create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
    };
    const mExpense = { create: vi.fn() };
    // $transaction supports BOTH forms: callback (checkout) and array (reorder).
    const mTransaction = vi.fn((arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: unknown) => unknown)({ expense: mExpense, shoppingListItem: mItem });
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
    return { mList, mItem, mExpense, mTransaction };
});

vi.mock("./db", () => ({
    prisma: {
        shoppingList: mList,
        shoppingListItem: mItem,
        expense: mExpense,
        $transaction: (a: unknown) => mTransaction(a),
    },
}));

const { mGetGroupMembers, mResolveCategoryId, mCalculateSplitAmounts, mPostExpenseLedger } = vi.hoisted(() => ({
    mGetGroupMembers: vi.fn(),
    mResolveCategoryId: vi.fn(),
    mCalculateSplitAmounts: vi.fn(),
    mPostExpenseLedger: vi.fn(),
}));
vi.mock("./membership", () => ({ getGroupMembers: (id: string) => mGetGroupMembers(id) }));
vi.mock("./category-db", () => ({ resolveCategoryId: (k: string, s: unknown) => mResolveCategoryId(k, s) }));
vi.mock("./splits", () => ({ calculateSplitAmounts: (...a: unknown[]) => mCalculateSplitAmounts(...a) }));
vi.mock("./ledger", () => ({ postExpenseLedger: (...a: unknown[]) => mPostExpenseLedger(...a) }));

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
    checkoutList,
    ListError,
    type ListWriteScope,
} from "./list-crud";

const GROUP: ListWriteScope = { kind: "group", groupId: "g1" };
const OWNER: ListWriteScope = { kind: "owner", ownerId: "u1" };

const groupList = { id: "l1", name: "Mercadona", groupId: "g1", ownerId: null };
const ownerList = { id: "lp", name: "Farmacia", groupId: null, ownerId: "u1" };

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
     mExpense.create, mTransaction, mGetGroupMembers, mResolveCategoryId, mCalculateSplitAmounts, mPostExpenseLedger]
        .forEach((m) => m.mockReset());
    mTransaction.mockImplementation((arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: unknown) => unknown)({ expense: mExpense, shoppingListItem: mItem });
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
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
    it("adds an item (sortOrder=max+1, only name required)", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
        mItem.create.mockResolvedValue({ id: "i1" });
        await createItemForScope(GROUP, "l1", { name: "leche" });
        const data = mItem.create.mock.calls[0][0].data;
        expect(data.listId).toBe("l1");
        expect(data.name).toBe("leche");
        expect(data.sortOrder).toBe(3);
        expect(data.quantity).toBeNull();
        expect(data.priceCents).toBeNull();
    });

    it("rejects a negative price with 400", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        const err = await expectError(() => createItemForScope(GROUP, "l1", { name: "leche", priceCents: -5 }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_PRICE");
    });

    it("rejects a non-integer quantity with 400", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        const err = await expectError(() => createItemForScope(GROUP, "l1", { name: "leche", quantity: 1.5 }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_QUANTITY");
    });
});

describe("updateItemForScope — field edit", () => {
    it("updates editable fields of an in-scope item", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findUnique.mockResolvedValue({ id: "i1", listId: "l1" });
        mItem.update.mockResolvedValue({ id: "i1" });
        await updateItemForScope(GROUP, "l1", "i1", { name: "pan", priceCents: 120, quantity: 2, unit: "ud" });
        const data = mItem.update.mock.calls[0][0].data;
        expect(data.name).toBe("pan");
        expect(data.priceCents).toBe(120);
        expect(data.quantity).toBe(2);
        expect(data.unit).toBe("ud");
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

describe("checkoutList — group bridge", () => {
    const items = [
        { id: "i1", priceCents: 300, linkedExpenseId: null },
        { id: "i2", priceCents: 200, linkedExpenseId: null },
    ];

    it("400s when there are no eligible (checked+priced+unlinked) items", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findMany.mockResolvedValue([]);
        const err = await expectError(() => checkoutList(GROUP, "l1", { actorUserId: "u1", category: "food" }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("NOTHING_TO_CHECKOUT");
    });

    it("creates ONE shared expense, posts the ledger and seals linkedExpenseId", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findMany.mockResolvedValue(items);
        mResolveCategoryId.mockResolvedValue("cat1");
        mGetGroupMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
        mCalculateSplitAmounts.mockReturnValue([
            { userId: "u1", amount: 250 },
            { userId: "u2", amount: 250 },
        ]);
        mExpense.create.mockResolvedValue({
            id: "e1", amount: 500, paidById: "u1", date: new Date(),
            splits: [{ userId: "u1", amount: 250 }, { userId: "u2", amount: 250 }],
        });
        mItem.updateMany.mockResolvedValue({ count: 2 });

        const res = await checkoutList(GROUP, "l1", { actorUserId: "u1", category: "food" });
        expect(res).toEqual({ expenseId: "e1", itemCount: 2, amountCents: 500 });

        const created = mExpense.create.mock.calls[0][0].data;
        expect(created.amount).toBe(500);
        expect(created.visibility).toBe("SHARED");
        expect(created.coupleId).toBe("g1");
        expect(created.categoryId).toBe("cat1");
        expect(created.paidById).toBe("u1");
        expect(created.splitStrategy).toBe("EQUAL");
        expect(mPostExpenseLedger).toHaveBeenCalledOnce();
        // Sealing is guarded on linkedExpenseId:null (idempotent).
        const seal = mItem.updateMany.mock.calls[0][0];
        expect(seal.where).toEqual({ id: { in: ["i1", "i2"] }, linkedExpenseId: null });
        expect(seal.data).toEqual({ linkedExpenseId: "e1" });
    });

    it("honours an explicit member payer, falls back to the actor otherwise", async () => {
        mList.findUnique.mockResolvedValue(groupList);
        mItem.findMany.mockResolvedValue(items);
        mResolveCategoryId.mockResolvedValue("cat1");
        mGetGroupMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
        mCalculateSplitAmounts.mockReturnValue([{ userId: "u1", amount: 500 }]);
        mExpense.create.mockResolvedValue({ id: "e2", amount: 500, paidById: "u2", date: new Date(), splits: [] });
        mItem.updateMany.mockResolvedValue({ count: 2 });

        await checkoutList(GROUP, "l1", { actorUserId: "u1", paidById: "u2", category: "food" });
        expect(mExpense.create.mock.calls[0][0].data.paidById).toBe("u2");
    });
});

describe("checkoutList — personal bridge", () => {
    it("creates a PERSONAL expense (no split, no ledger) and seals items", async () => {
        mList.findUnique.mockResolvedValue(ownerList);
        mItem.findMany.mockResolvedValue([{ id: "p1", priceCents: 700, linkedExpenseId: null }]);
        mResolveCategoryId.mockResolvedValue("catP");
        mExpense.create.mockResolvedValue({ id: "ep", amount: 700, date: new Date() });
        mItem.updateMany.mockResolvedValue({ count: 1 });

        const res = await checkoutList(OWNER, "lp", { actorUserId: "u1", category: "health" });
        expect(res).toEqual({ expenseId: "ep", itemCount: 1, amountCents: 700 });
        const created = mExpense.create.mock.calls[0][0].data;
        expect(created.visibility).toBe("PERSONAL");
        expect(created.coupleId).toBeNull();
        expect(created.ownerId).toBe("u1");
        expect(created.splits).toBeUndefined();
        expect(mPostExpenseLedger).not.toHaveBeenCalled();
    });
});
