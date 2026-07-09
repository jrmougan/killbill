import { describe, it, expect } from "vitest";
import { categoryKeyOf, type CategoryKeyed } from "./category-read";

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
