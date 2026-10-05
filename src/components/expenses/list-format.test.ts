import { describe, it, expect } from "vitest";
import { dayLabel, dayKey, expenseSubtitle, settlementText } from "./list-format";

const me = { id: "me", name: "Yo" };
const lu = { id: "lu", name: "Lucía" };
const da = { id: "da", name: "Dani" };

describe("dayLabel", () => {
    const now = new Date("2026-10-05T10:00:00Z"); // lunes 5 oct (Madrid)
    it("labels today and yesterday", () => {
        expect(dayLabel("2026-10-05T21:30:00Z", now)).toBe("Hoy"); // 23:30 Madrid, still the 5th
        expect(dayLabel("2026-10-04T08:00:00Z", now)).toBe("Ayer");
    });
    it("labels other days in the month as weekday + day", () => {
        expect(dayLabel("2026-10-03T12:00:00Z", now)).toBe("Sáb 3");
    });
    it("adds the month / year when they differ", () => {
        expect(dayLabel("2026-09-26T12:00:00Z", now)).toMatch(/^Sáb 26 sept?$/);
        expect(dayLabel("2025-09-26T12:00:00Z", now)).toMatch(/^26 sept? 2025$/);
    });
    it("buckets by Madrid day", () => {
        expect(dayKey("2026-10-04T22:30:00Z")).toBe("2026-10-05");
    });
});

describe("expenseSubtitle", () => {
    const couple = [me, lu];
    it("describes equal and exclusive splits in a couple", () => {
        expect(expenseSubtitle({ meId: "me", paidBy: "me", members: couple, splitStrategy: "EQUAL", splits: [{ userId: "me", amount: 50 }, { userId: "lu", amount: 50 }] }))
            .toBe("Pagaste tú · a medias");
        expect(expenseSubtitle({ meId: "me", paidBy: "lu", members: couple, splitStrategy: "EXCLUSIVE", splits: [{ userId: "me", amount: 100 }] }))
            .toBe("Pagó Lucía · solo para ti");
        expect(expenseSubtitle({ meId: "me", paidBy: "me", members: couple, splitStrategy: "EXCLUSIVE", splits: [{ userId: "lu", amount: 100 }] }))
            .toBe("Pagaste tú · solo para Lucía");
    });
    it("describes group splits", () => {
        const group = [me, lu, da];
        expect(expenseSubtitle({ meId: "me", paidBy: "me", members: group, splitStrategy: "EQUAL", splits: [{ userId: "me", amount: 34 }, { userId: "lu", amount: 33 }, { userId: "da", amount: 33 }] }))
            .toBe("Pagaste tú · a partes iguales");
        expect(expenseSubtitle({ meId: "me", paidBy: "me", members: group, splitStrategy: "CUSTOM", splits: [{ userId: "lu", amount: 50 }, { userId: "da", amount: 50 }] }))
            .toBe("Pagaste tú · para los demás");
        expect(expenseSubtitle({ meId: "me", paidBy: "da", members: group, splitStrategy: "CUSTOM", splits: [{ userId: "me", amount: 70 }, { userId: "da", amount: 30 }] }))
            .toBe("Pagó Dani · reparto personalizado");
    });
});

describe("settlementText", () => {
    it("words the direction from my point of view", () => {
        expect(settlementText({ meId: "me", fromId: "lu", toId: "me", members: [me, lu], methodLabel: "Efectivo", status: "CONFIRMED" }))
            .toEqual({ title: "Lucía te pagó", sub: "Liquidación · Efectivo · Confirmado" });
        expect(settlementText({ meId: "me", fromId: "me", toId: "lu", members: [me, lu], methodLabel: "", status: "PENDING" }))
            .toEqual({ title: "Pagaste a Lucía", sub: "Liquidación · Pendiente" });
    });
});
