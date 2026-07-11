import { describe, it, expect } from "vitest";
import {
    RESERVED_SYSTEM_KEYS,
    CATEGORY_KEY_RE,
    slugifyKey,
    slugsToReservedKey,
} from "./category-keys";

describe("RESERVED_SYSTEM_KEYS", () => {
    it("holds exactly the 8 system keys", () => {
        expect([...RESERVED_SYSTEM_KEYS].sort()).toEqual(
            ["entertainment", "food", "health", "other", "rent", "shopping", "transport", "utilities"],
        );
    });
});

describe("slugifyKey", () => {
    it("strips accents, lowercases and dash-joins", () => {
        expect(slugifyKey("Café con Leche")).toBe("cafe-con-leche");
        expect(slugifyKey("  Niños & Co!  ")).toBe("ninos-co");
    });

    it("produces keys that match CATEGORY_KEY_RE", () => {
        expect(CATEGORY_KEY_RE.test(slugifyKey("Mascotas"))).toBe(true);
    });
});

describe("slugsToReservedKey — editor warning mirror (decision #1)", () => {
    it("flags labels that slug to a reserved system key", () => {
        expect(slugsToReservedKey("Food")).toBe(true);
        expect(slugsToReservedKey("  other  ")).toBe(true);
        expect(slugsToReservedKey("Transport")).toBe(true);
    });

    it("passes labels that slug to a free key", () => {
        expect(slugsToReservedKey("Mascotas")).toBe(false);
        expect(slugsToReservedKey("Café")).toBe(false);
    });
});
