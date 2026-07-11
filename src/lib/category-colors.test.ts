import { describe, it, expect } from "vitest";
import {
    CATEGORY_PALETTE,
    isValidCategoryHex,
    hexWithAlpha,
    NEUTRAL_CATEGORY_HEX,
} from "./category-colors";

describe("isValidCategoryHex — closed-palette membership (decision #8)", () => {
    it("accepts in-palette hexes (case-insensitive)", () => {
        expect(isValidCategoryHex("#f472b6")).toBe(true);
        expect(isValidCategoryHex("#F472B6")).toBe(true);
    });

    it("rejects well-formed hexes that are NOT in the palette", () => {
        expect(isValidCategoryHex("#123456")).toBe(false);
    });

    it("rejects malformed / non-string values", () => {
        expect(isValidCategoryHex("#fff")).toBe(false);
        expect(isValidCategoryHex("f472b6")).toBe(false);
        expect(isValidCategoryHex(42)).toBe(false);
        expect(isValidCategoryHex(null)).toBe(false);
    });

    it("every palette entry validates against itself", () => {
        for (const hex of CATEGORY_PALETTE) expect(isValidCategoryHex(hex)).toBe(true);
    });
});

describe("hexWithAlpha — inline tinted backgrounds", () => {
    it("appends an 8-bit alpha channel to a 6-digit hex", () => {
        expect(hexWithAlpha("#fb923c", 0)).toBe("#fb923c00");
        expect(hexWithAlpha("#fb923c", 1)).toBe("#fb923cff");
        // ~12% → 0.12 * 255 ≈ 31 = 0x1f
        expect(hexWithAlpha("#fb923c", 0.12)).toBe("#fb923c1f");
    });

    it("clamps alpha into [0,1]", () => {
        expect(hexWithAlpha("#fb923c", -1)).toBe("#fb923c00");
        expect(hexWithAlpha("#fb923c", 5)).toBe("#fb923cff");
    });

    it("falls back to the neutral hex for malformed input (never breaks the render)", () => {
        expect(hexWithAlpha("nonsense", 1)).toBe(`${NEUTRAL_CATEGORY_HEX}ff`);
    });
});
