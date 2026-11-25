import { describe, expect, it } from "vitest";
import { formatQuantity, normalizeQuantity, parseQuantityInput } from "./list-quantity";

describe("parseQuantityInput", () => {
    it("accepts integers and decimals with comma or dot", () => {
        expect(parseQuantityInput("2")).toEqual({ ok: true, value: 2 });
        expect(parseQuantityInput("1,5")).toEqual({ ok: true, value: 1.5 });
        expect(parseQuantityInput("1.5")).toEqual({ ok: true, value: 1.5 });
        expect(parseQuantityInput(" 0,25 ")).toEqual({ ok: true, value: 0.25 });
        expect(parseQuantityInput("100000")).toEqual({ ok: true, value: 100000 });
    });

    it("treats empty as no quantity", () => {
        expect(parseQuantityInput("")).toEqual({ ok: true, value: null });
        expect(parseQuantityInput("   ")).toEqual({ ok: true, value: null });
    });

    it("rejects garbage instead of truncating or clearing (LIS-02)", () => {
        for (const bad of ["abc", "1,5,2", "-1", "0", "0,0", "1e3", "2 kg", ",5", "1."]) {
            const r = parseQuantityInput(bad);
            expect(r.ok, bad).toBe(false);
        }
        expect(parseQuantityInput("200000")).toEqual({ ok: false, error: "La cantidad máxima es 100.000" });
        expect(parseQuantityInput("1,2345")).toEqual({ ok: false, error: "La cantidad admite como mucho 3 decimales" });
    });
});

describe("normalizeQuantity", () => {
    it("accepts numbers and typed text, rejects other types", () => {
        expect(normalizeQuantity(undefined)).toEqual({ ok: true, value: null });
        expect(normalizeQuantity(null)).toEqual({ ok: true, value: null });
        expect(normalizeQuantity(3)).toEqual({ ok: true, value: 3 });
        expect(normalizeQuantity("1,5")).toEqual({ ok: true, value: 1.5 });
        expect(normalizeQuantity(Number.NaN).ok).toBe(false);
        expect(normalizeQuantity(true).ok).toBe(false);
    });

    it("formats with the es-ES decimal comma", () => {
        expect(formatQuantity(1.5)).toBe("1,5");
        expect(formatQuantity(2)).toBe("2");
    });
});
