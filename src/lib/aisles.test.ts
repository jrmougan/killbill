import { describe, it, expect } from "vitest";
import { AISLES, AISLE_KEYS, getAisle, normalizeAisle, autoAssignAisle } from "./aisles";

describe("aisle vocabulary", () => {
    it("has unique keys and includes the 'otros' bucket last", () => {
        const keys = AISLES.map((a) => a.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(AISLE_KEYS).toEqual(keys);
        expect(AISLES[AISLES.length - 1].key).toBe("otros");
    });

    it("is NOT the expense-category vocabulary (aisles, not spend buckets)", () => {
        // Guardrail for plan §3 rule 2: no verbatim expense keys.
        for (const forbidden of ["shopping", "food", "health", "transport", "utilities", "entertainment"]) {
            expect(AISLE_KEYS).not.toContain(forbidden);
        }
    });
});

describe("getAisle / normalizeAisle", () => {
    it("resolves a valid key and rejects unknown ones", () => {
        expect(getAisle("lacteos")?.label).toBe("Lácteos y huevos");
        expect(getAisle("nope")).toBeUndefined();
        expect(getAisle(null)).toBeUndefined();
    });

    it("normalizes case/space and returns null for invalid", () => {
        expect(normalizeAisle("  LACTEOS ")).toBe("lacteos");
        expect(normalizeAisle("pasillo-fantasma")).toBeNull();
    });
});

describe("autoAssignAisle", () => {
    it("matches accent-insensitively", () => {
        expect(autoAssignAisle("Plátano de Canarias")).toBe("fruta_verdura");
        expect(autoAssignAisle("LECHE DESNATADA")).toBe("lacteos");
        expect(autoAssignAisle("Pechuga de pollo")).toBe("carne_pescado");
    });

    it("returns null (never 'otros') when nothing matches", () => {
        expect(autoAssignAisle("bombillas led")).toBeNull();
        expect(autoAssignAisle("")).toBeNull();
    });

    it("prefers the longer, more specific keyword", () => {
        // "tomate" → fruta_verdura, but "tomate frito" → despensa (longer wins).
        expect(autoAssignAisle("tomate")).toBe("fruta_verdura");
        expect(autoAssignAisle("bote de tomate frito")).toBe("despensa");
    });
});
