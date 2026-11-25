import { describe, it, expect } from "vitest";
import { applyAmountKey, sanitizeAmount, amountToCents, centsToAmount } from "./amount-input";
import { quickShares, quickSplitPayload, balanceDelta, previewLine, quickSplitOptions } from "./quick-split";

const type = (keys: string) =>
    [...keys].reduce((acc, k) => applyAmountKey(acc, (k === "<" ? "del" : k) as never), "");

describe("amount numpad rules", () => {
    it("builds an es-ES amount and caps decimals at 2", () => {
        expect(type("43,859")).toBe("43,85");
        expect(type(",5")).toBe("0,5");
        expect(type("1,,2")).toBe("1,2");
    });

    it("drops leading zeros and caps at 6 integer digits", () => {
        expect(type("007")).toBe("7");
        expect(type("1234567")).toBe("123456");
        expect(type("123456,78")).toBe("123456,78");
    });

    it("deletes the last character", () => {
        expect(type("12,3<<")).toBe("12");
    });

    it("sanitizes typed / pasted input with dot or comma", () => {
        expect(sanitizeAmount("25.50")).toBe("25,50");
        expect(sanitizeAmount("1.234,5")).toBe("1,23"); // second separator ignored, decimals capped
        expect(sanitizeAmount("abc12")).toBe("12");
    });

    it("converts to and from cents exactly", () => {
        expect(amountToCents("43,85")).toBe(4385);
        expect(amountToCents("0,5")).toBe(50);
        expect(amountToCents("12,")).toBe(1200);
        expect(amountToCents("")).toBe(0);
        expect(centsToAmount(4385)).toBe("43,85");
        expect(centsToAmount(1200)).toBe("12");
        expect(centsToAmount(705)).toBe("7,05");
    });
});

const me = { id: "me", name: "Yo" };
const lucia = { id: "lu", name: "Lucía" };
const dani = { id: "da", name: "Dani" };
const marta = { id: "ma", name: "Marta" };

describe("quick split", () => {
    it("labels the Reparto options per space size", () => {
        expect(quickSplitOptions([me, lucia], "me").map((o) => o.label)).toEqual(["A medias", "Solo para mí", "Solo Lucía"]);
        expect(quickSplitOptions([me, lucia, dani], "me").map((o) => o.label)).toEqual(["Iguales", "Solo para mí", "Los demás"]);
    });

    it("computes shares in cents that sum to the total", () => {
        expect(quickShares("equal", [me, lucia], "me", 4385)).toEqual({ me: 2193, lu: 2192 });
        expect(quickShares("mine", [me, lucia], "me", 1000)).toEqual({ me: 1000 });
        expect(quickShares("theirs", [me, dani, marta], "me", 1001)).toEqual({ da: 501, ma: 500 });
    });

    it("maps to the API payload", () => {
        expect(quickSplitPayload("equal", [me, lucia], "me", 100)).toEqual({});
        expect(quickSplitPayload("mine", [me, lucia], "me", 100)).toEqual({ beneficiaryId: "me" });
        expect(quickSplitPayload("theirs", [me, lucia], "me", 100)).toEqual({ beneficiaryId: "lu" });
        expect(quickSplitPayload("theirs", [me, dani, marta], "me", 101)).toEqual({
            customSplits: [{ userId: "da", amount: 51 }, { userId: "ma", amount: 50 }],
        });
    });

    it("previews how my balance moves", () => {
        const members = [me, lucia];
        const shares = quickShares("equal", members, "me", 4385);
        const d = balanceDelta("me", "me", shares, 4385);
        expect(d).toBe(2192);
        expect(previewLine({ deltaCents: d, totalCents: 4385, members, meId: "me", payerId: "me" }))
            .toMatch(/^Lucía te deberá 21,92\s€ más$/);
        const d2 = balanceDelta("lu", "me", quickShares("mine", members, "me", 1900), 1900);
        expect(previewLine({ deltaCents: d2, totalCents: 1900, members, meId: "me", payerId: "lu" }))
            .toMatch(/^Deberás 19,00\s€ a Lucía$/);
        expect(previewLine({ deltaCents: 0, totalCents: 1900, members, meId: "me", payerId: "me" })).toBe("No cambia el saldo");
        expect(previewLine({ deltaCents: 0, totalCents: 0, members, meId: "me", payerId: "me" })).toBe("");
    });

    it("previews group debts against the payer or the rest", () => {
        const members = [me, dani, marta];
        expect(previewLine({ deltaCents: 500, totalCents: 1500, members, meId: "me", payerId: "me" }))
            .toMatch(/^Te deberán 5,00\s€ más$/);
        expect(previewLine({ deltaCents: -500, totalCents: 1500, members, meId: "me", payerId: "da" }))
            .toMatch(/^Deberás 5,00\s€ a Dani$/);
    });
});
