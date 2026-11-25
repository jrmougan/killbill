import { describe, expect, it } from "vitest";
import {
    averageMonthly,
    balanceAtMonthEnds,
    budgetPercent,
    budgetState,
    compareWithPrevious,
    inBucket,
    lastMonths,
    monthSeries,
} from "./aggregate";

// 6 Oct 2026, 12:00 Madrid (CEST, UTC+2).
const NOW = new Date("2026-10-06T10:00:00Z");
const exp = (iso: string, amount: number, splits: { userId: string; amount: number }[] = []) => ({
    date: new Date(iso),
    amount,
    splits,
});

describe("lastMonths", () => {
    it("returns 6 Madrid half-open months, oldest first", () => {
        const b = lastMonths(NOW);
        expect(b).toHaveLength(6);
        // May 1 00:00 Madrid (CEST) = Apr 30 22:00 UTC.
        expect(b[0].start.toISOString()).toBe("2026-04-30T22:00:00.000Z");
        // Current month: Oct 1 00:00 CEST → Nov 1 00:00 CET.
        expect(b[5].start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
        expect(b[5].end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
        // Contiguous.
        for (let i = 1; i < 6; i++) expect(b[i].start.getTime()).toBe(b[i - 1].end.getTime());
    });

    it("excludes future-dated expenses from the current month (MES-01)", () => {
        const current = lastMonths(NOW)[5];
        expect(inBucket(new Date("2026-11-15T10:00:00Z"), current)).toBe(false);
        // 1 Nov 00:30 Madrid is already November.
        expect(inBucket(new Date("2026-10-31T23:30:00Z"), current)).toBe(false);
        // 1 Oct 00:30 Madrid is October even though it is still 30 Sep in UTC.
        expect(inBucket(new Date("2026-09-30T22:30:00Z"), current)).toBe(true);
    });
});

describe("monthSeries", () => {
    const buckets = lastMonths(NOW);
    const expenses = [
        exp("2026-10-05T10:00:00Z", 10000, [{ userId: "a", amount: 5000 }, { userId: "b", amount: 5000 }]),
        exp("2026-11-15T10:00:00Z", 4000, [{ userId: "a", amount: 2000 }]), // future → ignored
        exp("2026-09-10T10:00:00Z", 2000), // no split rows → even share
    ];

    it("totals, counts and my share per month; the future month never counts", () => {
        const s = monthSeries(expenses, buckets, { userId: "a", memberCount: 2, shared: true });
        expect(s.map((m) => m.total)).toEqual([0, 0, 0, 0, 2000, 10000]);
        expect(s.map((m) => m.count)).toEqual([0, 0, 0, 0, 1, 1]);
        expect(s.map((m) => m.myShare)).toEqual([0, 0, 0, 0, 1000, 5000]);
        expect(s[5].label).toBe("oct");
    });

    it("has no share series in personal scope", () => {
        const s = monthSeries(expenses, buckets, { userId: "a", memberCount: 1, shared: false });
        expect(s.every((m) => m.myShare === null)).toBe(true);
    });
});

describe("averageMonthly / compareWithPrevious", () => {
    it("averages only months with spend", () => {
        expect(averageMonthly([{ total: 0 }, { total: 100 }, { total: 300 }])).toBe(200);
        expect(averageMonthly([{ total: 0 }])).toBe(0);
    });

    it("distinguishes a delta, an empty previous month and a first month", () => {
        expect(compareWithPrevious([{ total: 0 }, { total: 100 }, { total: 150 }])).toEqual({ kind: "delta", percent: 50 });
        expect(compareWithPrevious([{ total: 100 }, { total: 0 }, { total: 150 }])).toEqual({ kind: "zero" });
        expect(compareWithPrevious([{ total: 0 }, { total: 0 }, { total: 150 }])).toEqual({ kind: "first" });
    });
});

describe("balanceAtMonthEnds", () => {
    it("accumulates the opening balance and stops at each month end", () => {
        const buckets = lastMonths(NOW).slice(4); // sep, oct
        const series = balanceAtMonthEnds(
            [
                { amount: 1000, postedAt: new Date("2026-01-10T10:00:00Z") }, // before window
                { amount: -300, postedAt: new Date("2026-09-15T10:00:00Z") },
                { amount: 500, postedAt: new Date("2026-10-02T10:00:00Z") },
                { amount: 9999, postedAt: new Date("2026-12-01T10:00:00Z") }, // after window
            ],
            buckets,
        );
        expect(series).toEqual([
            { label: expect.stringMatching(/^sept?$/), balance: 700 },
            { label: "oct", balance: 1200 },
        ]);
    });
});

describe("budget state", () => {
    it("is ok below 80 %, warn from 80 % to 100 %, over beyond", () => {
        expect(budgetState(7999, 10000)).toBe("ok");
        expect(budgetState(8000, 10000)).toBe("warn");
        expect(budgetState(10000, 10000)).toBe("warn");
        expect(budgetState(10001, 10000)).toBe("over");
        expect(budgetPercent(2502, 10008)).toBe(25);
        expect(budgetPercent(5, 0)).toBe(0);
    });
});
