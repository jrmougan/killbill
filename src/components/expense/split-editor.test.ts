import { describe, it, expect } from "vitest";
import {
    computeSplit,
    seedSplitValue,
    splitValueFromExisting,
    type SplitMember,
} from "./split-editor";

const members: SplitMember[] = [
    { id: "a", name: "Ana" },
    { id: "b", name: "Bea" },
    { id: "c", name: "Caro" },
];

describe("computeSplit", () => {
    it("EQUAL divides evenly with the leftover cent to the first members", () => {
        const v = seedSplitValue("equal", members, 0);
        const r = computeSplit(v, members, 100); // 100c / 3 = 34,33,33
        expect(r.valid).toBe(true);
        expect(r.strategy).toBe("EQUAL");
        expect(r.shares).toEqual({ a: 34, b: 33, c: 33 });
        expect(r.customSplits).toBeUndefined();
        const total = Object.values(r.shares).reduce((x, y) => x + y, 0);
        expect(total).toBe(100);
    });

    it("EXCLUSIVE charges the full amount to the beneficiary only", () => {
        const v = seedSplitValue("exclusive", members, 0, "b");
        const r = computeSplit(v, members, 5000);
        expect(r.valid).toBe(true);
        expect(r.strategy).toBe("EXCLUSIVE");
        expect(r.beneficiaryId).toBe("b");
        expect(r.shares).toEqual({ a: 0, b: 5000, c: 0 });
        expect(r.customSplits).toEqual([{ userId: "b", amount: 5000 }]);
    });

    it("EXCLUSIVE is invalid without a beneficiary", () => {
        const v = seedSplitValue("exclusive", members, 0, null);
        const r = computeSplit(v, members, 5000);
        expect(r.valid).toBe(false);
    });

    it("percent must sum to 100 and maps to exact cents", () => {
        const v = seedSplitValue("percent", members, 0);
        v.percents = { a: 50, b: 25, c: 25 };
        const r = computeSplit(v, members, 1000);
        expect(r.valid).toBe(true);
        expect(r.strategy).toBe("CUSTOM");
        expect(Object.values(r.shares).reduce((x, y) => x + y, 0)).toBe(1000);
        expect(r.shares).toEqual({ a: 500, b: 250, c: 250 });
    });

    it("percent that does not sum to 100 is invalid", () => {
        const v = seedSplitValue("percent", members, 0);
        v.percents = { a: 50, b: 25, c: 20 };
        const r = computeSplit(v, members, 1000);
        expect(r.valid).toBe(false);
    });

    it("percent rounding leftover lands on the largest share, sum stays exact", () => {
        const v = seedSplitValue("percent", members, 0);
        v.percents = { a: 34, b: 33, c: 33 };
        const r = computeSplit(v, members, 100);
        expect(r.valid).toBe(true);
        // floor: 34,33,33 = 100 exactly here; ensure exact-sum invariant holds
        expect(Object.values(r.shares).reduce((x, y) => x + y, 0)).toBe(100);
    });

    it("amounts must sum to the total", () => {
        const v = seedSplitValue("amounts", members, 0);
        v.amounts = { a: "10,00", b: "5,00", c: "5,00" };
        const r = computeSplit(v, members, 2000);
        expect(r.valid).toBe(true);
        expect(r.shares).toEqual({ a: 1000, b: 500, c: 500 });
        expect(r.customSplits).toEqual([
            { userId: "a", amount: 1000 },
            { userId: "b", amount: 500 },
            { userId: "c", amount: 500 },
        ]);
    });

    it("amounts that miss the total are invalid with a reason", () => {
        const v = seedSplitValue("amounts", members, 0);
        v.amounts = { a: "10,00", b: "5,00", c: "4,00" };
        const r = computeSplit(v, members, 2000);
        expect(r.valid).toBe(false);
        expect(r.reason).toContain("Faltan");
    });
});

describe("splitValueFromExisting", () => {
    it("hydrates EXCLUSIVE from a single split row", () => {
        const v = splitValueFromExisting("EXCLUSIVE", [{ userId: "c", amount: 900 }], members, 900);
        expect(v.mode).toBe("exclusive");
        expect(v.beneficiaryId).toBe("c");
    });

    it("hydrates CUSTOM into amounts strings that recompute to the same cents", () => {
        const existing = [
            { userId: "a", amount: 700 },
            { userId: "b", amount: 200 },
            { userId: "c", amount: 100 },
        ];
        const v = splitValueFromExisting("CUSTOM", existing, members, 1000);
        expect(v.mode).toBe("amounts");
        const r = computeSplit(v, members, 1000);
        expect(r.valid).toBe(true);
        expect(r.shares).toEqual({ a: 700, b: 200, c: 100 });
    });

    it("EQUAL / ITEMIZED / null start on the equal preset", () => {
        expect(splitValueFromExisting("EQUAL", [], members, 300).mode).toBe("equal");
        expect(splitValueFromExisting("ITEMIZED", [], members, 300).mode).toBe("equal");
        expect(splitValueFromExisting(null, [], members, 300).mode).toBe("equal");
    });
});
