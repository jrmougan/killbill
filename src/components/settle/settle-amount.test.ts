import { describe, expect, it } from "vitest";
import { settleAmountText, validateSettleAmount } from "./settle-amount";

describe("validateSettleAmount", () => {
    it("parses es-ES amounts strictly", () => {
        expect(validateSettleAmount("12,50")).toEqual({ cents: 1250, error: null });
        expect(validateSettleAmount("1.000,50")).toEqual({ cents: 100050, error: null });
        for (const bad of ["", "abc", "0,004", "1.2.3", "0"]) {
            expect(validateSettleAmount(bad).cents).toBeNull();
            expect(validateSettleAmount(bad).error).toBeTruthy();
        }
    });

    it("caps the amount to what is left to settle", () => {
        expect(validateSettleAmount("50,00", 5000)).toEqual({ cents: 5000, error: null });
        const over = validateSettleAmount("50,01", 5000);
        expect(over.cents).toBeNull();
        expect(over.error).toMatch(/^No puede ser más de 50,00\s€/);
    });
});

describe("settleAmountText", () => {
    it("formats cents for the field", () => {
        expect(settleAmountText(7930)).toBe("79,30");
        expect(settleAmountText(5)).toBe("0,05");
    });
});
