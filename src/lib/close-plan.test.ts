import { describe, expect, it } from "vitest";
import { closePlan, openDebtCount } from "./close-plan";

describe("closePlan (RV-02)", () => {
    it("lists the greedy plan when nothing is pending", () => {
        expect(closePlan({ A: -5000, B: -3000, C: 6000, D: 2000 })).toEqual([
            { fromId: "A", toId: "C", amountCents: 5000 },
            { fromId: "B", toId: "C", amountCents: 1000 },
            { fromId: "B", toId: "D", amountCents: 2000 },
        ]);
    });

    it("a PENDING to another creditor than the plan's does not list the debt twice", () => {
        // B owes 30 € and the plan pairs B with D, but B already paid C 30 € (PENDING).
        const balances = { A: -3000, B: -3000, C: 3000, D: 3000 };
        expect(closePlan(balances, [{ fromUserId: "B", toUserId: "C", amount: 3000 }])).toEqual([
            { fromId: "A", toId: "D", amountCents: 3000 },
        ]);
    });

    it("nothing is listed while every balance is within the tolerance", () => {
        expect(closePlan({ A: 1, B: -1 })).toEqual([]);
    });
});

describe("openDebtCount (RV-02)", () => {
    it("counts rounding leftovers the API still blocks on (any sign)", () => {
        // B −1, C −1, A +2: assertCanArchive answers OPEN_BALANCES.
        expect(openDebtCount({ A: 2, B: -1, C: -1 })).toBe(2);
    });

    it("is 0 only when no balance is open", () => {
        expect(openDebtCount({ A: 1, B: -1 })).toBe(0);
        expect(openDebtCount({})).toBe(0);
    });

    it("counts plan rows, not debtors", () => {
        expect(openDebtCount({ A: -5000, B: -3000, C: 6000, D: 2000 })).toBe(3);
    });
});
