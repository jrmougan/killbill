import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    categoryKeyOf,
    mergeCategories,
    toCategoryMeta,
    type CategoryKeyed,
    type CategoryRow,
} from "./category-read";

// Mock the Prisma singleton so resolveCategoryId / getEffectiveCategories (which
// live in category-db.ts) can be exercised without a DB. Same module specifier
// category-db imports, so the mock takes effect there too.
const mockCategoryFindFirst = vi.fn();
const mockCategoryFindMany = vi.fn();
vi.mock("./db", () => ({
    prisma: {
        category: {
            findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
            findMany: (...a: unknown[]) => mockCategoryFindMany(...a),
        },
    },
}));
// Imported after the mock is declared (vi.mock is hoisted above imports anyway).
import { resolveCategoryId, getEffectiveCategories } from "./category-db";

/** Minimal CategoryRow factory for merge fixtures (DB shape — `icon` is a name). */
function row(over: Partial<CategoryRow> & Pick<CategoryRow, "key">): CategoryRow {
    return {
        id: `id-${over.key}`,
        label: over.key,
        labelEn: over.key,
        emoji: "📦",
        icon: "Receipt",
        hex: "#9ca3af",
        isSystem: false,
        sortOrder: 0,
        ...over,
    };
}

/** The 8 system categories — must mirror the ExpenseCategory enum. */
const SYSTEM_KEYS = [
    "shopping",
    "food",
    "rent",
    "utilities",
    "transport",
    "entertainment",
    "health",
    "other",
] as const;

interface Row extends CategoryKeyed {
    amount: number; // integer cents
}

/** OLD aggregation: key on the enum column (pre-read-switch behaviour). */
function aggregateOld(rows: Row[]): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const r of rows) {
        const key = r.category || "other";
        acc[key] = (acc[key] ?? 0) + r.amount;
    }
    return acc;
}

/** NEW aggregation: key on the relational Category (categoryKeyOf). */
function aggregateNew(rows: Row[]): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const r of rows) {
        const key = categoryKeyOf(r);
        acc[key] = (acc[key] ?? 0) + r.amount;
    }
    return acc;
}

describe("categoryKeyOf", () => {
    it("prefers the relational categoryRef.key", () => {
        expect(categoryKeyOf({ category: "food", categoryRef: { key: "food" } })).toBe("food");
    });

    it("falls back to the enum column when categoryId is null", () => {
        expect(categoryKeyOf({ category: "rent", categoryRef: null })).toBe("rent");
        expect(categoryKeyOf({ category: "rent" })).toBe("rent");
    });

    it("defaults to 'other' when both are missing (defensive)", () => {
        expect(categoryKeyOf({ category: undefined as unknown as string, categoryRef: null })).toBe("other");
    });

    it("lets a group-custom key win over the mirrored enum (intended divergence)", () => {
        // A group-custom Category can carry any key; once categoryId points at it,
        // the TABLE is the source of truth, not the enum snapshot.
        expect(categoryKeyOf({ category: "other", categoryRef: { key: "mascotas" } })).toBe("mascotas");
    });
});

describe("aggregation parity old(enum) vs new(categoryRef) — all 8 system categories", () => {
    it("is identical on fully dual-written rows (categoryRef mirrors the enum)", () => {
        // Two rows per category with odd-cent amounts to exercise summation.
        const rows: Row[] = SYSTEM_KEYS.flatMap((key, i) => [
            { category: key, categoryRef: { key }, amount: 1001 + i * 7 },
            { category: key, categoryRef: { key }, amount: 250033 + i * 13 },
        ]);

        const oldAgg = aggregateOld(rows);
        const newAgg = aggregateNew(rows);

        expect(newAgg).toEqual(oldAgg);
        expect(Object.keys(newAgg).sort()).toEqual([...SYSTEM_KEYS].sort());
        // Spot-check a bucket total stays integer cents.
        expect(newAgg.shopping).toBe(1001 + 250033);
    });

    it("is identical when some rows are not yet backfilled (categoryRef null → enum fallback)", () => {
        const rows: Row[] = SYSTEM_KEYS.flatMap((key, i) => [
            { category: key, categoryRef: { key }, amount: 500 + i },
            { category: key, categoryRef: null, amount: 999 + i }, // legacy row
        ]);

        expect(aggregateNew(rows)).toEqual(aggregateOld(rows));
    });

    it("diverges ONLY for group-custom categories, keyed by the table", () => {
        const rows: Row[] = [
            { category: "food", categoryRef: { key: "food" }, amount: 100 },
            // Custom category persisted with enum snapshot 'other' (normalization)
            // but a real relational identity of its own.
            { category: "other", categoryRef: { key: "mascotas" }, amount: 200 },
        ];

        expect(aggregateOld(rows)).toEqual({ food: 100, other: 200 });
        expect(aggregateNew(rows)).toEqual({ food: 100, mascotas: 200 });
    });
});

describe("toCategoryMeta", () => {
    it("renames the DB `icon` column to `iconName` and copies the rest", () => {
        const meta = toCategoryMeta(
            row({ key: "food", id: "c1", label: "Comida", labelEn: "food", emoji: "🍕", icon: "Coffee", hex: "#fb923c", isSystem: true, sortOrder: 3 }),
        );
        expect(meta).toEqual({
            id: "c1",
            key: "food",
            label: "Comida",
            labelEn: "food",
            emoji: "🍕",
            iconName: "Coffee",
            hex: "#fb923c",
            isSystem: true,
            sortOrder: 3,
        });
        expect(meta).not.toHaveProperty("icon");
    });
});

describe("mergeCategories — system ∪ custom with shadow-by-key", () => {
    it("returns only system rows when the context has no custom", () => {
        const system = [row({ key: "food", sortOrder: 1, isSystem: true }), row({ key: "rent", sortOrder: 2, isSystem: true })];
        const merged = mergeCategories(system, []);
        expect(merged.map((c) => c.key)).toEqual(["food", "rent"]);
        expect(merged.every((c) => c.isSystem)).toBe(true);
    });

    it("appends context-custom categories to the system set", () => {
        const system = [row({ key: "other", sortOrder: 8, isSystem: true })];
        const custom = [row({ key: "mascotas", sortOrder: 9, emoji: "🐶" })];
        const merged = mergeCategories(system, custom);
        expect(merged.map((c) => c.key)).toEqual(["other", "mascotas"]);
        expect(merged.find((c) => c.key === "mascotas")?.emoji).toBe("🐶");
    });

    it("lets a custom row SHADOW the system row with the same key", () => {
        const system = [row({ key: "food", id: "sys-food", emoji: "🍕", hex: "#fb923c", isSystem: true, sortOrder: 2 })];
        const custom = [row({ key: "food", id: "grp-food", emoji: "🥗", hex: "#00ff00", isSystem: false, sortOrder: 2 })];
        const merged = mergeCategories(system, custom);
        // Exactly one `food`, and it is the custom one.
        expect(merged.filter((c) => c.key === "food")).toHaveLength(1);
        const food = merged.find((c) => c.key === "food")!;
        expect(food.id).toBe("grp-food");
        expect(food.emoji).toBe("🥗");
        expect(food.isSystem).toBe(false);
    });

    it("orders by (sortOrder, key)", () => {
        const system = [
            row({ key: "other", sortOrder: 8, isSystem: true }),
            row({ key: "food", sortOrder: 2, isSystem: true }),
        ];
        const custom = [
            row({ key: "zebra", sortOrder: 2 }), // same sortOrder as food → tie-break by key
            row({ key: "apple", sortOrder: 5 }),
        ];
        const merged = mergeCategories(system, custom);
        expect(merged.map((c) => c.key)).toEqual(["food", "zebra", "apple", "other"]);
    });
});

describe("resolveCategoryId — tri-layer ({ groupId }, { ownerId }, system)", () => {
    beforeEach(() => {
        mockCategoryFindFirst.mockReset();
    });

    it("resolves a personal-custom category by ownerId before the system fallback", async () => {
        mockCategoryFindFirst.mockResolvedValueOnce({ id: "own-food" }); // ownerId custom hit
        const id = await resolveCategoryId("food", { ownerId: "u1" });
        expect(id).toBe("own-food");
        // Only the ownerId lookup ran — system fallback was not needed.
        expect(mockCategoryFindFirst).toHaveBeenCalledTimes(1);
        expect(mockCategoryFindFirst.mock.calls[0][0].where).toEqual({ ownerId: "u1", key: "food" });
    });

    it("falls back to the system row (groupId=null, ownerId=null) when no personal-custom exists", async () => {
        mockCategoryFindFirst
            .mockResolvedValueOnce(null) // ownerId custom miss
            .mockResolvedValueOnce({ id: "sys-food" }); // system hit
        const id = await resolveCategoryId("food", { ownerId: "u1" });
        expect(id).toBe("sys-food");
        expect(mockCategoryFindFirst).toHaveBeenCalledTimes(2);
        expect(mockCategoryFindFirst.mock.calls[1][0].where).toEqual({ groupId: null, ownerId: null, key: "food" });
    });

    it("resolves a group-custom category by groupId before the system fallback", async () => {
        mockCategoryFindFirst.mockResolvedValueOnce({ id: "grp-food" });
        const id = await resolveCategoryId("food", { groupId: "c1" });
        expect(id).toBe("grp-food");
        expect(mockCategoryFindFirst.mock.calls[0][0].where).toEqual({ groupId: "c1", key: "food" });
    });

    it("goes straight to system when neither groupId nor ownerId is given", async () => {
        mockCategoryFindFirst.mockResolvedValueOnce({ id: "sys-other" });
        const id = await resolveCategoryId("other");
        expect(id).toBe("sys-other");
        expect(mockCategoryFindFirst).toHaveBeenCalledTimes(1);
        expect(mockCategoryFindFirst.mock.calls[0][0].where).toEqual({ groupId: null, ownerId: null, key: "other" });
    });
});

describe("getEffectiveCategories — DB fetch feeding the merge", () => {
    beforeEach(() => {
        mockCategoryFindMany.mockReset();
    });

    it("merges system with the ownerId-scoped custom set", async () => {
        mockCategoryFindMany
            .mockResolvedValueOnce([row({ key: "food", sortOrder: 2, isSystem: true })]) // system
            .mockResolvedValueOnce([row({ key: "mascotas", sortOrder: 9 })]); // ownerId custom
        const merged = await getEffectiveCategories({ ownerId: "u1" });
        expect(merged.map((c) => c.key)).toEqual(["food", "mascotas"]);
        // Second query scoped by ownerId.
        expect(mockCategoryFindMany.mock.calls[1][0].where).toEqual({ ownerId: "u1" });
    });

    it("returns system-only when there is no context", async () => {
        mockCategoryFindMany.mockResolvedValueOnce([row({ key: "food", isSystem: true })]);
        const merged = await getEffectiveCategories();
        expect(merged.map((c) => c.key)).toEqual(["food"]);
        // No custom query issued.
        expect(mockCategoryFindMany).toHaveBeenCalledTimes(1);
    });
});
