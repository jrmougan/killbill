import { describe, expect, it } from "vitest";
import { bumpedQuantity, findDuplicate, itemKey } from "./duplicates";

describe("shopping duplicates", () => {
    const items = [
        { id: "1", name: "Leche", checked: false },
        { id: "2", name: "Plátanos", checked: true },
    ];

    it("matches pending items ignoring case, accents and spacing", () => {
        expect(itemKey("  LÉCHE  entera ")).toBe("leche entera");
        expect(findDuplicate(items, "leche")?.id).toBe("1");
        expect(findDuplicate(items, " LECHE ")?.id).toBe("1");
        expect(findDuplicate(items, "leche entera")).toBeUndefined();
    });

    it("ignores ticked-off items and empty names", () => {
        expect(findDuplicate(items, "platanos")).toBeUndefined();
        expect(findDuplicate(items, "   ")).toBeUndefined();
    });

    it("bumps the quantity (none counts as 1) within the max", () => {
        expect(bumpedQuantity(null)).toBe(2);
        expect(bumpedQuantity(1.5)).toBe(2.5);
        expect(bumpedQuantity(100000)).toBeNull();
    });
});
