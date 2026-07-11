import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma singleton. Defined via vi.hoisted so the vi.mock factory (which
// is hoisted above imports) can safely reference these objects.
const { mCat, mBudget, mExpense, mRecurring, mTransaction } = vi.hoisted(() => {
    const mCat = {
        findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
        aggregate: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const mBudget = { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() };
    const mExpense = { updateMany: vi.fn() };
    const mRecurring = { updateMany: vi.fn() };
    // $transaction supports BOTH forms used by the module:
    //  - callback form (delete): call fn with a tx exposing the same delegates.
    //  - array form (reorder): Promise.all the array.
    const mTransaction = vi.fn((arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: unknown) => unknown)({
                expense: mExpense, recurringSeries: mRecurring, budget: mBudget, category: mCat,
            });
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
    return { mCat, mBudget, mExpense, mRecurring, mTransaction };
});

vi.mock("./db", () => ({
    prisma: {
        category: mCat,
        budget: mBudget,
        expense: mExpense,
        recurringSeries: mRecurring,
        $transaction: (a: unknown) => mTransaction(a),
    },
}));

import {
    createCategoryForScope,
    updateCategoryForScope,
    deleteCategoryForScope,
    reorderCategoriesForScope,
    duplicateCategoryForScope,
    slugifyKey,
    CategoryError,
    RESERVED_SYSTEM_KEYS,
    type CategoryWriteScope,
} from "./category-crud";

const GROUP: CategoryWriteScope = { kind: "group", groupId: "c1" };
const OWNER: CategoryWriteScope = { kind: "owner", ownerId: "u1" };

const VALID = {
    label: "Mascotas",
    emoji: "🐶",
    iconName: "Heart",
    hex: "#8b5cf6",
};

/** Await a call and return the thrown CategoryError (fails if it didn't throw). */
async function expectError(fn: () => Promise<unknown>): Promise<CategoryError> {
    try {
        await fn();
    } catch (e) {
        expect(e).toBeInstanceOf(CategoryError);
        return e as CategoryError;
    }
    throw new Error("expected CategoryError, none thrown");
}

beforeEach(() => {
    [mCat.findFirst, mCat.findUnique, mCat.findMany, mCat.aggregate, mCat.create, mCat.update, mCat.delete,
     mBudget.findMany, mBudget.findFirst, mBudget.updateMany, mExpense.updateMany, mRecurring.updateMany, mTransaction]
        .forEach((m) => m.mockReset());
    mTransaction.mockImplementation((arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: unknown) => unknown)({
                expense: mExpense, recurringSeries: mRecurring, budget: mBudget, category: mCat,
            });
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
});

describe("slugifyKey", () => {
    it("lowercases, strips accents and hyphenates", () => {
        expect(slugifyKey("Café con Leche")).toBe("cafe-con-leche");
        expect(slugifyKey("  Niños & Co!  ")).toBe("ninos-co");
    });
});

describe("createCategoryForScope — happy path", () => {
    it("creates a group-custom category (isSystem forced false, sortOrder=max+1, labelEn copied)", async () => {
        mCat.findFirst.mockResolvedValue(null); // no duplicate
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: 7 } });
        mCat.create.mockResolvedValue({ id: "new1" });

        await createCategoryForScope(GROUP, VALID);

        const data = mCat.create.mock.calls[0][0].data;
        expect(data.key).toBe("mascotas");
        expect(data.label).toBe("Mascotas");
        expect(data.labelEn).toBe("Mascotas"); // decision #4: copied from label
        expect(data.emoji).toBe("🐶");
        expect(data.icon).toBe("Heart"); // DB column stores the lucide NAME
        expect(data.hex).toBe("#8b5cf6");
        expect(data.color).toBe("");
        expect(data.bgColor).toBe("");
        expect(data.isSystem).toBe(false);
        expect(data.sortOrder).toBe(8);
        expect(data.groupId).toBe("c1");
        expect(data.ownerId).toBeNull();
    });

    it("creates a personal category scoped by ownerId", async () => {
        mCat.findFirst.mockResolvedValue(null);
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: null } }); // first custom
        mCat.create.mockResolvedValue({ id: "new2" });

        await createCategoryForScope(OWNER, { ...VALID, labelEn: "Pets" });

        const data = mCat.create.mock.calls[0][0].data;
        expect(data.ownerId).toBe("u1");
        expect(data.groupId).toBeNull();
        expect(data.labelEn).toBe("Pets");
        expect(data.sortOrder).toBe(1);
    });

    it("respects an explicit key when provided", async () => {
        mCat.findFirst.mockResolvedValue(null);
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
        mCat.create.mockResolvedValue({ id: "new3" });

        await createCategoryForScope(GROUP, { ...VALID, key: "PetsAndDogs" });
        expect(mCat.create.mock.calls[0][0].data.key).toBe("petsanddogs");
    });
});

describe("createCategoryForScope — validation", () => {
    it("rejects a reserved system key with 400 (decision #1)", async () => {
        for (const key of RESERVED_SYSTEM_KEYS) {
            const err = await expectError(() => createCategoryForScope(GROUP, { ...VALID, key }));
            expect(err.status).toBe(400);
            expect(err.code).toBe("RESERVED_KEY");
        }
        expect(mCat.create).not.toHaveBeenCalled();
    });

    it("rejects a duplicate key in the scope with 409", async () => {
        mCat.findFirst.mockResolvedValue({ id: "existing" });
        const err = await expectError(() => createCategoryForScope(GROUP, VALID));
        expect(err.status).toBe(409);
        expect(err.code).toBe("DUPLICATE_KEY");
        expect(mCat.create).not.toHaveBeenCalled();
    });

    it("rejects an empty label with 400", async () => {
        const err = await expectError(() => createCategoryForScope(GROUP, { ...VALID, label: "   " }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_LABEL");
    });

    it("rejects a multi-grapheme emoji with 400", async () => {
        const err = await expectError(() => createCategoryForScope(GROUP, { ...VALID, emoji: "🐶🐱" }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_EMOJI");
    });

    it("accepts a single ZWJ-composed emoji (one grapheme)", async () => {
        mCat.findFirst.mockResolvedValue(null);
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
        mCat.create.mockResolvedValue({ id: "fam" });
        // 👨‍👩‍👧 is several code points but ONE grapheme cluster.
        await createCategoryForScope(GROUP, { ...VALID, emoji: "👨‍👩‍👧" });
        expect(mCat.create).toHaveBeenCalled();
    });

    it("rejects an unregistered icon name with 400", async () => {
        const err = await expectError(() => createCategoryForScope(GROUP, { ...VALID, iconName: "NotARealIcon" }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_ICON");
    });

    it("rejects a hex outside the closed palette with 400", async () => {
        const err = await expectError(() => createCategoryForScope(GROUP, { ...VALID, hex: "#123456" }));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_COLOR");
    });
});

describe("updateCategoryForScope", () => {
    it("403s when the category is a system row", async () => {
        mCat.findUnique.mockResolvedValue({ id: "sys", isSystem: true, groupId: null, ownerId: null });
        const err = await expectError(() => updateCategoryForScope(GROUP, "sys", { label: "X" }));
        expect(err.status).toBe(403);
        expect(err.code).toBe("SYSTEM_CATEGORY");
    });

    it("403s when the category belongs to another scope", async () => {
        mCat.findUnique.mockResolvedValue({ id: "cat", isSystem: false, groupId: "other-group", ownerId: null });
        const err = await expectError(() => updateCategoryForScope(GROUP, "cat", { label: "X" }));
        expect(err.status).toBe(403);
        expect(err.code).toBe("OUT_OF_SCOPE");
    });

    it("updates visual fields of an in-scope custom", async () => {
        mCat.findUnique.mockResolvedValue({ id: "cat", isSystem: false, groupId: "c1", ownerId: null });
        mCat.update.mockResolvedValue({ id: "cat" });
        await updateCategoryForScope(GROUP, "cat", { label: "Perros", hex: "#10b981" });
        const data = mCat.update.mock.calls[0][0].data;
        expect(data.label).toBe("Perros");
        expect(data.hex).toBe("#10b981");
    });
});

describe("deleteCategoryForScope — reassignment", () => {
    const custom = { id: "del", key: "mascotas", isSystem: false, groupId: "c1", ownerId: null };
    const systemTarget = { id: "other-sys", isSystem: true, groupId: null, ownerId: null };

    it("400s without an explicit reassignment target (decision #7)", async () => {
        mCat.findUnique.mockResolvedValueOnce(custom);
        const err = await expectError(() => deleteCategoryForScope(GROUP, "del", null));
        expect(err.status).toBe(400);
        expect(err.code).toBe("REASSIGN_REQUIRED");
    });

    it("403s when trying to delete a system category", async () => {
        mCat.findUnique.mockResolvedValueOnce({ ...custom, isSystem: true });
        const err = await expectError(() => deleteCategoryForScope(GROUP, "del", "other-sys"));
        expect(err.status).toBe(403);
        expect(err.code).toBe("SYSTEM_CATEGORY");
    });

    it("reassigns Expense/RecurringSeries/Budget to the target and deletes, in a tx", async () => {
        mCat.findUnique
            .mockResolvedValueOnce(custom) // loadEditable
            .mockResolvedValueOnce(systemTarget); // target lookup
        mBudget.findMany.mockResolvedValue([]); // no budgets to move
        mExpense.updateMany.mockResolvedValue({ count: 3 });
        mRecurring.updateMany.mockResolvedValue({ count: 0 });
        mBudget.updateMany.mockResolvedValue({ count: 0 });
        mCat.delete.mockResolvedValue({ id: "del" });

        const res = await deleteCategoryForScope(GROUP, "del", "other-sys");
        expect(res).toEqual({ deleted: "del", reassignedTo: "other-sys", key: "mascotas" });
        expect(mExpense.updateMany).toHaveBeenCalledWith({ where: { categoryId: "del" }, data: { categoryId: "other-sys" } });
        expect(mRecurring.updateMany).toHaveBeenCalledWith({ where: { categoryId: "del" }, data: { categoryId: "other-sys" } });
        expect(mBudget.updateMany).toHaveBeenCalledWith({ where: { categoryId: "del" }, data: { categoryId: "other-sys" } });
        expect(mCat.delete).toHaveBeenCalledWith({ where: { id: "del" } });
    });

    it("409s on a Budget unique collision and never touches the tx (decision #3)", async () => {
        mCat.findUnique
            .mockResolvedValueOnce(custom)
            .mockResolvedValueOnce(systemTarget);
        // One budget on the deleted category...
        mBudget.findMany.mockResolvedValue([
            { id: "b1", periodStart: new Date("2026-07-01"), coupleId: "c1", ownerId: null },
        ]);
        // ...and the target already has a budget in that same period/scope.
        mBudget.findFirst.mockResolvedValue({ id: "clash" });

        const err = await expectError(() => deleteCategoryForScope(GROUP, "del", "other-sys"));
        expect(err.status).toBe(409);
        expect(err.code).toBe("BUDGET_CONFLICT");
        expect(mCat.delete).not.toHaveBeenCalled();
        expect(mExpense.updateMany).not.toHaveBeenCalled();
    });

    it("400s when the target is out of scope", async () => {
        mCat.findUnique
            .mockResolvedValueOnce(custom)
            .mockResolvedValueOnce({ id: "foreign", isSystem: false, groupId: "other-group", ownerId: null });
        const err = await expectError(() => deleteCategoryForScope(GROUP, "del", "foreign"));
        expect(err.status).toBe(400);
        expect(err.code).toBe("TARGET_OUT_OF_SCOPE");
    });
});

describe("duplicateCategoryForScope", () => {
    const systemFood = {
        id: "sys-food", key: "food", label: "Comida", labelEn: "Food",
        emoji: "🍔", icon: "Utensils", hex: "#f59e0b", // system hex may be outside the closed palette
        isSystem: true, groupId: null, ownerId: null,
    };

    it("duplicates a SYSTEM category into the scope with a derived non-reserved key", async () => {
        mCat.findUnique.mockResolvedValueOnce(systemFood); // source
        mCat.findMany.mockResolvedValueOnce([]); // no scoped custom → nothing taken
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
        mCat.create.mockResolvedValue({ id: "dup1" });

        await duplicateCategoryForScope(GROUP, "sys-food");

        const data = mCat.create.mock.calls[0][0].data;
        expect(data.key).toBe("food-copia"); // not reserved (decision #1 honoured for free)
        expect(RESERVED_SYSTEM_KEYS.has(data.key)).toBe(false);
        expect(data.label).toBe("Comida (copia)");
        expect(data.labelEn).toBe("Food (copy)");
        expect(data.emoji).toBe("🍔");
        expect(data.icon).toBe("Utensils"); // copied verbatim
        expect(data.hex).toBe("#f59e0b"); // NOT re-validated against the palette
        expect(data.isSystem).toBe(false); // forced
        expect(data.groupId).toBe("c1");
        expect(data.ownerId).toBeNull();
        expect(data.sortOrder).toBe(4);
    });

    it("bumps the copy suffix when '-copia' is already taken in the scope", async () => {
        mCat.findUnique.mockResolvedValueOnce(systemFood);
        mCat.findMany.mockResolvedValueOnce([{ key: "food-copia" }]);
        mCat.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
        mCat.create.mockResolvedValue({ id: "dup2" });

        await duplicateCategoryForScope(GROUP, "sys-food");
        expect(mCat.create.mock.calls[0][0].data.key).toBe("food-copia-2");
    });

    it("404s when the source category does not exist", async () => {
        mCat.findUnique.mockResolvedValueOnce(null);
        const err = await expectError(() => duplicateCategoryForScope(GROUP, "ghost"));
        expect(err.status).toBe(404);
        expect(err.code).toBe("SOURCE_NOT_FOUND");
        expect(mCat.create).not.toHaveBeenCalled();
    });

    it("400s when the source is a custom of another scope", async () => {
        mCat.findUnique.mockResolvedValueOnce({
            id: "foreign", key: "x", label: "X", labelEn: "X", emoji: "❓", icon: "Receipt", hex: "#8b5cf6",
            isSystem: false, groupId: "other-group", ownerId: null,
        });
        const err = await expectError(() => duplicateCategoryForScope(GROUP, "foreign"));
        expect(err.status).toBe(400);
        expect(err.code).toBe("SOURCE_OUT_OF_SCOPE");
        expect(mCat.create).not.toHaveBeenCalled();
    });

    it("400s when no sourceId is given", async () => {
        const err = await expectError(() => duplicateCategoryForScope(GROUP, ""));
        expect(err.status).toBe(400);
        expect(err.code).toBe("SOURCE_REQUIRED");
    });
});

describe("reorderCategoriesForScope", () => {
    it("rejects an order that doesn't match the scope's custom set", async () => {
        mCat.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
        const err = await expectError(() => reorderCategoriesForScope(GROUP, ["a"]));
        expect(err.status).toBe(400);
        expect(err.code).toBe("INVALID_ORDER");
    });

    it("writes sortOrder 1..n in the given order", async () => {
        mCat.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
        mCat.update.mockResolvedValue({});
        const res = await reorderCategoriesForScope(GROUP, ["b", "a"]);
        expect(res).toEqual({ reordered: 2 });
        expect(mCat.update).toHaveBeenNthCalledWith(1, { where: { id: "b" }, data: { sortOrder: 1 } });
        expect(mCat.update).toHaveBeenNthCalledWith(2, { where: { id: "a" }, data: { sortOrder: 2 } });
    });
});
