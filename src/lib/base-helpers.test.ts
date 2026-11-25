import { describe, expect, it } from "vitest";
import { parseEuroInput, parseAmountInput } from "./currency";
import { safeReturnTo } from "./safe-return";
import { monthRange, daysLeftInMonth } from "./month-range";

describe("parseEuroInput", () => {
    it.each([
        ["12", 1200], ["12,5", 1250], ["12,50", 1250], ["12.50", 1250], ["0,99", 99], [",5", 50],
        ["1.234,56", 123456], ["1,234.56", 123456], ["1.234", 123400], ["1.234.567", 123456700],
        ["1 234,56 €", 123456], ["1.000,50", 100050], ["43,85", 4385],
    ])("%s → %d cents", (input, cents) => expect(parseEuroInput(input)).toBe(cents));
    it.each(["", "abc", "1,234", "1.2.3", "1,2,3", "12,345", "0,004", "-5", "1.23.456", ".", ","])(
        "rejects %s", (input) => expect(parseEuroInput(input)).toBeNull());
    it("parseAmountInput falls back to 0 instead of a wrong value", () => {
        expect(parseAmountInput("1.234,56")).toBe(1234.56);
        expect(parseAmountInput("basura")).toBe(0);
    });
});

describe("safeReturnTo", () => {
    it.each(["/lists/abc", "/dashboard?scope=personal", "/a#b"])("keeps %s", (p) => expect(safeReturnTo(p)).toBe(p));
    it.each(["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "javascript:alert(1)", "evil", "", undefined, null])(
        "rejects %j", (p) => expect(safeReturnTo(p as string)).toBeNull());
});

describe("monthRange (Europe/Madrid)", () => {
    it("is half-open and local-midnight based", () => {
        const { start, end } = monthRange(new Date("2026-10-05T10:00:00Z"));
        expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z"); // 1 Oct 00:00 CEST
        expect(end.toISOString()).toBe("2026-10-31T23:00:00.000Z");   // 1 Nov 00:00 CET
    });
    it("handles the late-night edge and offsets", () => {
        // 31 Oct 23:30 Madrid is still October.
        expect(monthRange(new Date("2026-10-31T22:30:00Z")).start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
        expect(monthRange(new Date("2026-01-10T10:00:00Z"), -1).start.toISOString()).toBe("2025-11-30T23:00:00.000Z");
    });
    it("counts days left including today", () => {
        expect(daysLeftInMonth(new Date("2026-10-05T10:00:00Z"))).toBe(27);
    });
});
