import { describe, it, expect } from "vitest";
import { buildTicket, formatPeriod, isAtPeace, myTransfers, ticketMeta } from "./settle-model";

describe("myTransfers", () => {
    it("couple: the debtor pays the creditor and the creditor sees the same amount", () => {
        const balances = { a: 2500, b: -2500 };
        expect(myTransfers(balances, "b")).toEqual([{ userId: "a", direction: "pay", amount: 2500 }]);
        expect(myTransfers(balances, "a")).toEqual([{ userId: "b", direction: "receive", amount: 2500 }]);
    });

    it("group: only transfers that involve me, largest first", () => {
        // a is owed 30, b owed 10; c owes 25, me owes 15.
        const balances = { a: 3000, b: 1000, c: -2500, me: -1500 };
        const mine = myTransfers(balances, "me");
        expect(mine.every((t) => t.direction === "pay")).toBe(true);
        expect(mine.reduce((s, t) => s + t.amount, 0)).toBe(1500);
        const forA = myTransfers(balances, "a");
        expect(forA.every((t) => t.direction === "receive")).toBe(true);
        expect(forA.reduce((s, t) => s + t.amount, 0)).toBe(3000);
    });

    it("at peace: no transfers", () => {
        expect(myTransfers({ a: 0, b: 1, c: -1 }, "a")).toEqual([]);
        expect(isAtPeace(1)).toBe(true);
        expect(isAtPeace(-2)).toBe(false);
    });
});

describe("buildTicket", () => {
    it("adds up: balance = paid by me − my share + carry", () => {
        const t = buildTicket(
            [
                { amount: 6000, paidById: "me", myShare: 3000, equal: true },
                { amount: 2000, paidById: "lu", myShare: 1000, equal: true },
            ],
            "me",
            1500,
        );
        expect(t).toMatchObject({ count: 2, total: 8000, myShare: 4000, paidByMe: 6000, paidByOthers: 2000, allEqual: true });
        expect(t.paidByMe - t.myShare + t.carry).toBe(t.balance);
        expect(t.carry).toBe(-500);
    });

    it("flags custom splits so the UI stops claiming '÷n'", () => {
        const t = buildTicket([{ amount: 1000, paidById: "lu", myShare: 700, equal: false }], "me", -700);
        expect(t.allEqual).toBe(false);
        expect(t.carry).toBe(0);
    });
});

describe("period formatting", () => {
    it("same month", () => {
        expect(formatPeriod(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-05T10:00:00Z"))).toBe("1 – 5 OCT");
    });
    it("across months and years", () => {
        expect(formatPeriod(new Date("2026-09-28T10:00:00Z"), new Date("2026-10-05T10:00:00Z"))).toMatch(/^28 SEPT? – 5 OCT$/);
        expect(formatPeriod(new Date("2025-12-28T10:00:00Z"), new Date("2026-01-05T10:00:00Z"))).toBe("28 DIC 2025 – 5 ENE 2026");
    });
    it("meta line", () => {
        expect(ticketMeta(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-05T10:00:00Z"), 10)).toBe("1 – 5 OCT · 10 GASTOS");
        expect(ticketMeta(new Date("2026-10-05T10:00:00Z"), new Date("2026-10-05T10:00:00Z"), 1)).toBe("5 OCT · 1 GASTO");
        expect(ticketMeta(null, new Date(), 0)).toBe("SIN GASTOS NUEVOS");
    });
});
