import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
    jsonObject, id, idParams, cents, eurosToCents, isoDay, expenseDate, recurringInterval,
    categoryKey, categoryHex, listQuantity, intParam, paginationQuery,
} from "./schemas";
import { CATEGORY_PALETTE } from "@/lib/category-colors";

const msg = (schema: z.ZodType, v: unknown) => {
    const r = schema.safeParse(v);
    return r.success ? null : r.error.issues[0].message;
};

describe("schemas", () => {
    it("jsonObject rejects non-objects with 'Petición no válida' and strips unknown keys", () => {
        const s = jsonObject({ a: z.number().optional() });
        expect(msg(s, null)).toBe("Petición no válida");
        expect(msg(s, undefined)).toBe("Petición no válida");
        expect(msg(s, [1])).toBe("Petición no válida");
        expect(s.parse({ a: 1, b: 2 })).toEqual({ a: 1 });
    });

    it("id / idParams", () => {
        expect(id().parse("clx1")).toBe("clx1");
        expect(msg(id("Espacio no válido"), "")).toBe("Espacio no válido");
        expect(msg(id(), 3)).toBe("Identificador no válido");
        expect(idParams.parse({ id: "e1" })).toEqual({ id: "e1" });
    });

    it("cents: integers only, bounds", () => {
        expect(cents().parse(150)).toBe(150);
        expect(msg(cents(), 1.5)).toBe("Importe no válido");
        expect(msg(cents({ min: 0, message: "Negativo" }), -1)).toBe("Negativo");
        expect(msg(cents({ max: 10, maxMessage: "Demasiado" }), 11)).toBe("Demasiado");
    });

    it("eurosToCents: number or numeric string → positive cents", () => {
        const s = eurosToCents({ max: 99_999_999, maxMessage: "El importe máximo es 999.999,99 €" });
        expect(s.parse(12.5)).toBe(1250);
        expect(s.parse("15.50")).toBe(1550);
        expect(s.parse(0.1 + 0.2)).toBe(30);
        for (const bad of [0, -1, "", null, "abc", "15,50", true, [1], NaN]) {
            expect(msg(s, bad)).toBe("Importe no válido");
        }
        expect(msg(s, 1_000_000)).toBe("El importe máximo es 999.999,99 €");
    });

    it("eurosToCents empty:'null' keeps null / '' as null (PATCH)", () => {
        const s = eurosToCents({ empty: "null" });
        expect(s.parse(null)).toBeNull();
        expect(s.parse("")).toBeNull();
        expect(msg(s, 0)).toBe("Importe no válido");
    });

    it("isoDay: strict real calendar days", () => {
        expect(isoDay().parse("2024-02-29")).toBe("2024-02-29");
        expect(msg(isoDay(), "2025-02-29")).toBe("Fecha inválida");
        expect(msg(isoDay(), 20250101)).toBe("Fecha inválida");
    });

    it("expenseDate: optional, 12:00 UTC, expense-input messages", () => {
        const s = z.object({ date: expenseDate });
        expect(s.parse({})).toEqual({});
        expect(s.parse({ date: null }).date).toBeUndefined();
        expect(s.parse({ date: "" }).date).toBeUndefined();
        expect(s.parse({ date: "2026-09-15" }).date).toEqual(new Date("2026-09-15T12:00:00.000Z"));
        expect(msg(s, { date: "2026-02-31" })).toBe("Fecha inválida: 2026-02-31");
        expect(msg(s, { date: "1999-12-31" })).toMatch(/anterior al año 2000/);
        expect(msg(s, { date: 5 })).toBe("Fecha inválida");
    });

    it("recurringInterval", () => {
        expect(recurringInterval().parse("monthly")).toBe("monthly");
        expect(msg(recurringInterval(), "daily")).toBe("Periodicidad no válida");
    });

    it("categoryKey keeps the value and rejects blanks", () => {
        expect(categoryKey().parse(" food")).toBe(" food");
        expect(msg(categoryKey(), "  ")).toBe("Categoría no válida");
        expect(msg(categoryKey(), 1)).toBe("Categoría no válida");
    });

    it("categoryHex uses the closed palette", () => {
        expect(categoryHex().parse(CATEGORY_PALETTE[0])).toBe(CATEGORY_PALETTE[0]);
        expect(msg(categoryHex(), "#123456")).toBe("Color no válido (fuera de la paleta)");
    });

    it("listQuantity delegates to normalizeQuantity", () => {
        const s = z.object({ quantity: listQuantity });
        expect(s.parse({ quantity: "1,5" }).quantity).toBe(1.5);
        expect(s.parse({ quantity: "" }).quantity).toBeNull();
        expect(s.parse({}).quantity).toBeUndefined();
        expect(msg(s, { quantity: "abc" })).toMatch(/cantidad/i);
    });

    it("intParam / paginationQuery are lenient and clamped", () => {
        const p = paginationQuery({ defaultLimit: 50, maxLimit: 200 });
        expect(p.parse({})).toEqual({ limit: 50 });
        expect(p.parse({ limit: "abc", cursor: "e1" })).toEqual({ limit: 50, cursor: "e1" });
        expect(p.parse({ limit: "0" }).limit).toBe(1);
        expect(p.parse({ limit: "999" }).limit).toBe(200);
        expect(intParam({ default: 0 }).parse("7")).toBe(7);
    });
});
