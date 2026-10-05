import { describe, expect, it } from "vitest";
import {
    absEuros,
    balanceWords,
    cardSub,
    categorySlices,
    dayLabel,
    expenseSub,
    madridMonthName,
    madridMonthStart,
    parseInviteToken,
    rowBalance,
    signedEuros,
} from "./home-format";

const nb = (s: string) => s.replace(/ /g, " ");

describe("money copy", () => {
    it("signs balances like the balance-amount contract", () => {
        expect(nb(signedEuros(5000))).toBe("+50,00 €");
        expect(nb(signedEuros(-5000))).toBe("-50,00 €");
        expect(nb(signedEuros(0))).toBe("0,00 €");
        expect(nb(signedEuros(0.4))).toBe("0,00 €");
    });
    it("renders unsigned card amounts and row balances", () => {
        expect(nb(absEuros(-1234))).toBe("12,34 €");
        expect(nb(rowBalance(1200))).toBe("+12,00 €");
        expect(nb(rowBalance(-500))).toBe("−5,00 €");
        expect(rowBalance(0)).toBe("En paz");
    });
});

describe("balance wording", () => {
    it("names the other person in a pair", () => {
        expect(balanceWords(100, ["Lucía Pérez"])).toBe("Lucía te debe");
        expect(balanceWords(-100, ["Lucía"])).toBe("Le debes a Lucía");
        expect(balanceWords(0, ["Lucía"])).toBe("Estáis en paz");
    });
    it("is generic in groups", () => {
        expect(balanceWords(100, ["A", "B"])).toBe("Te deben");
        expect(balanceWords(-100, ["A", "B"])).toBe("Debes");
    });
    it("summarises membership", () => {
        expect(cardSub([])).toBe("Solo tú");
        expect(cardSub(["Lucía"])).toBe("con Lucía");
        expect(cardSub(["A", "B", "C"])).toBe("4 personas");
    });
});

describe("Madrid dates", () => {
    it("labels today/yesterday on Madrid calendar days", () => {
        const now = new Date("2026-10-05T10:00:00Z");
        expect(dayLabel("2026-10-05T08:00:00Z", now)).toBe("Hoy");
        // 23:30 UTC on the 4th is already the 5th in Madrid.
        expect(dayLabel("2026-10-04T23:30:00Z", now)).toBe("Hoy");
        expect(dayLabel("2026-10-04T12:00:00Z", now)).toBe("Ayer");
        expect(dayLabel("2026-10-01T12:00:00Z", now)).toBe("1 oct");
    });
    it("computes the Madrid month start across DST", () => {
        expect(madridMonthStart(new Date("2026-10-05T10:00:00Z")).toISOString()).toBe("2026-09-30T22:00:00.000Z");
        expect(madridMonthStart(new Date("2026-01-15T10:00:00Z")).toISOString()).toBe("2025-12-31T23:00:00.000Z");
        // 1 Nov 00:30 Madrid is still 31 Oct in UTC.
        expect(madridMonthStart(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
        expect(madridMonthName(new Date("2026-10-05T10:00:00Z"))).toBe("Octubre");
    });
});

describe("expense subtitle", () => {
    const names = { me: "Álvaro", l: "Lucía", m: "Marta" };
    it("describes a 50/50 couple expense", () => {
        expect(expenseSub({ payerId: "me", meId: "me", memberCount: 2, names, splits: [{ userId: "me", amount: 500 }, { userId: "l", amount: 500 }] }))
            .toBe("Pagaste tú · a medias");
    });
    it("describes exclusive and group shares", () => {
        expect(expenseSub({ payerId: "l", meId: "me", memberCount: 2, names, splits: [{ userId: "me", amount: 900 }] }))
            .toBe("Pagó Lucía · solo para ti");
        expect(expenseSub({ payerId: "me", meId: "me", memberCount: 2, names, splits: [{ userId: "l", amount: 900 }, { userId: "me", amount: 0 }] }))
            .toBe("Pagaste tú · solo para Lucía");
        expect(expenseSub({ payerId: "m", meId: "me", memberCount: 3, names, splits: [{ userId: "me", amount: 334 }, { userId: "l", amount: 333 }, { userId: "m", amount: 333 }] }))
            .toBe("Pagó Marta · a partes iguales");
        expect(expenseSub({ payerId: "me", meId: "me", memberCount: 3, names, splits: [{ userId: "me", amount: 700 }, { userId: "l", amount: 300 }] }))
            .toBe("Pagaste tú · a medida");
    });
});

describe("category slices", () => {
    it("sorts and computes percentages", () => {
        const s = categorySlices({ food: 300, home: 700, other: 0 }, (k) => ({ label: k, hex: "#000" }));
        expect(s.map((x) => [x.key, x.pct])).toEqual([["home", 70], ["food", 30]]);
        expect(categorySlices({}, () => ({ label: "", hex: "" }))).toEqual([]);
    });
});

describe("invite token parsing", () => {
    it("accepts full links and bare tokens", () => {
        expect(parseInviteToken("https://finanzas.mougan.es/i/abc_DEF-1?x=1")).toBe("abc_DEF-1");
        expect(parseInviteToken("  /i/tok  ")).toBe("tok");
        expect(parseInviteToken("tok123")).toBe("tok123");
        expect(parseInviteToken("   ")).toBeNull();
        expect(parseInviteToken("two words")).toBeNull();
    });
    it("rejects path tricks that would leave /i/ (IE-26)", () => {
        expect(parseInviteToken("https://evil.com/i/../../dashboard")).toBeNull();
        expect(parseInviteToken("..")).toBeNull();
        expect(parseInviteToken("/i/%2E%2E")).toBeNull();
        expect(parseInviteToken("/i/a%2Fb")).toBeNull();
    });
});
