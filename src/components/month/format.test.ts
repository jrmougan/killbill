import { describe, expect, it } from "vitest";
import {
    capitalize,
    daysLeftInMonth,
    deltaPercent,
    formatAmountShort,
    monthName,
    monthShort,
    normalizeMonthView,
    sharePercent,
} from "./format";

describe("month format helpers", () => {
    it("normalizes the view param, defaulting to budget", () => {
        expect(normalizeMonthView(undefined)).toBe("budget");
        expect(normalizeMonthView("analysis")).toBe("analysis");
        expect(normalizeMonthView(["analysis", "budget"])).toBe("analysis");
        expect(normalizeMonthView("nope")).toBe("budget");
    });

    it("capitalises Spanish month names", () => {
        expect(capitalize("")).toBe("");
        expect(monthName(new Date(2026, 9, 5))).toBe("Octubre");
        expect(monthShort(new Date(2026, 8, 1))).toMatch(/^sept?$/);
        expect(monthShort(new Date(2026, 9, 1))).toBe("oct");
    });

    it("counts the days left in the month including today", () => {
        expect(daysLeftInMonth(new Date(2026, 9, 5))).toBe(27);
        expect(daysLeftInMonth(new Date(2026, 9, 31))).toBe(1);
        expect(daysLeftInMonth(new Date(2028, 1, 1))).toBe(29); // leap February
    });

    it("drops decimals only for whole euros", () => {
        expect(formatAmountShort(10000)).toBe("100");
        expect(formatAmountShort(2502)).toBe("25,02");
        expect(formatAmountShort(10008)).toBe("100,08");
        expect(formatAmountShort(0)).toBe("0");
    });

    it("computes month-over-month deltas and shares", () => {
        expect(deltaPercent(105, 100)).toBe(5);
        expect(deltaPercent(80, 100)).toBe(-20);
        expect(deltaPercent(50, 0)).toBeNull();
        expect(sharePercent(1, 3)).toBe(33);
        expect(sharePercent(5, 0)).toBe(0);
    });
});
