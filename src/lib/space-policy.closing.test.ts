import { describe, it, expect } from "vitest";
import {
    assertCanArchive,
    assertNotArchived,
    hasOpenBalance,
    kickBlocker,
    leaveBlocker,
    madridToday,
    normalizeSpaceName,
    parseTripEndDate,
    settleUrlFor,
    SpacePolicyError,
} from "./space-policy";

function codeOf(fn: () => void): string | undefined {
    try {
        fn();
    } catch (e) {
        return (e as SpacePolicyError).code;
    }
    return undefined;
}

describe("space-policy — closing, leaving, naming, trip dates", () => {
    it("hasOpenBalance tolerates ±1 cent (same as /settle)", () => {
        expect(hasOpenBalance(0)).toBe(false);
        expect(hasOpenBalance(1)).toBe(false);
        expect(hasOpenBalance(-1)).toBe(false);
        expect(hasOpenBalance(2)).toBe(true);
        expect(hasOpenBalance(-5000)).toBe(true);
    });

    it("settleUrlFor targets the space explicitly", () => {
        expect(settleUrlFor("abc")).toBe("/settle?space=abc");
    });

    it("assertCanArchive: pending settlements first, then open balances", () => {
        expect(() => assertCanArchive({ balances: { a: 0, b: 0 }, pendingSettlements: 0 })).not.toThrow();
        expect(() => assertCanArchive({ balances: { a: 1, b: -1 }, pendingSettlements: 0 })).not.toThrow();
        expect(codeOf(() => assertCanArchive({ balances: { a: 500, b: -500 }, pendingSettlements: 2 }))).toBe("PENDING_SETTLEMENTS");
        expect(() => assertCanArchive({ balances: {}, pendingSettlements: 2 })).toThrow(/2 pagos pendientes/);
        expect(codeOf(() => assertCanArchive({ balances: { a: 500, b: -500 }, pendingSettlements: 0 }))).toBe("OPEN_BALANCES");
    });

    it("assertNotArchived only rejects ARCHIVED", () => {
        expect(() => assertNotArchived("ACTIVE")).not.toThrow();
        expect(() => assertNotArchived("SETTLING")).not.toThrow();
        expect(codeOf(() => assertNotArchived("ARCHIVED"))).toBe("SPACE_NOT_WRITABLE");
    });

    describe("leaveBlocker", () => {
        const base = { role: "MEMBER", ownerCount: 1, activeCount: 2, balanceCents: 0, force: false };
        it("allows a settled member", () => expect(leaveBlocker(base)).toBeNull());
        it("LAST_OWNER when the only owner leaves others behind (even with force)", () => {
            expect(leaveBlocker({ ...base, role: "OWNER", force: true })?.code).toBe("LAST_OWNER");
        });
        it("the sole remaining member may leave", () => {
            expect(leaveBlocker({ ...base, role: "OWNER", activeCount: 1 })).toBeNull();
        });
        it("another owner unblocks", () => {
            expect(leaveBlocker({ ...base, role: "OWNER", ownerCount: 2 })).toBeNull();
        });
        it("HAS_BALANCE carries the balance, force skips it", () => {
            expect(leaveBlocker({ ...base, balanceCents: -2500 })).toMatchObject({ code: "HAS_BALANCE", balanceCents: -2500 });
            expect(leaveBlocker({ ...base, balanceCents: -2500, force: true })).toBeNull();
        });
    });

    describe("kickBlocker (A2)", () => {
        it("allows expelling a settled member (±1 cent tolerated)", () => {
            expect(kickBlocker(0)).toBeNull();
            expect(kickBlocker(1)).toBeNull();
            expect(kickBlocker(-1)).toBeNull();
        });
        it("409 HAS_BALANCE for a debtor or a creditor, with the balance", () => {
            expect(kickBlocker(-2500)).toMatchObject({ code: "HAS_BALANCE", status: 409, balanceCents: -2500 });
            expect(kickBlocker(2500)).toMatchObject({ code: "HAS_BALANCE", status: 409, balanceCents: 2500 });
            expect(kickBlocker(2500)?.error).toMatch(/Quedad en paz/);
        });
    });

    it("normalizeSpaceName trims/collapses and bounds length", () => {
        expect(normalizeSpaceName("  Mi   piso ")).toBe("Mi piso");
        expect(normalizeSpaceName("x".repeat(60))).toHaveLength(60);
        expect(codeOf(() => normalizeSpaceName("x".repeat(61)))).toBe("INVALID_NAME");
        expect(codeOf(() => normalizeSpaceName("   "))).toBe("INVALID_NAME");
        expect(codeOf(() => normalizeSpaceName(null))).toBe("INVALID_NAME");
    });

    describe("parseTripEndDate", () => {
        const now = new Date("2026-10-06T10:00:00Z");
        it("end of the Madrid day in summer (UTC+2) and winter (UTC+1)", () => {
            expect(parseTripEndDate("2026-10-10", now).toISOString()).toBe("2026-10-10T21:59:59.999Z");
            expect(parseTripEndDate("2026-12-01", now).toISOString()).toBe("2026-12-01T22:59:59.999Z");
        });
        it("DST change day (25 Oct 2026 has 25h)", () => {
            expect(parseTripEndDate("2026-10-25", now).toISOString()).toBe("2026-10-25T22:59:59.999Z");
        });
        it("month overflow (31 Oct → 1 Nov midnight)", () => {
            expect(parseTripEndDate("2026-10-31", now).toISOString()).toBe("2026-10-31T22:59:59.999Z");
        });
        it("today is valid, yesterday is not", () => {
            expect(parseTripEndDate("2026-10-06", now).getTime()).toBeGreaterThan(now.getTime());
            expect(() => parseTripEndDate("2026-10-05", now)).toThrow(/pasado/);
        });
        it("rejects impossible, malformed and far-future dates", () => {
            expect(codeOf(() => parseTripEndDate("2026-02-31", now))).toBe("INVALID_END_DATE");
            expect(codeOf(() => parseTripEndDate("mañana", now))).toBe("INVALID_END_DATE");
            expect(() => parseTripEndDate("9999-01-01", now)).toThrow(/lejos/);
            expect(codeOf(() => parseTripEndDate(123, now))).toBe("INVALID_END_DATE");
        });
        it("madridToday is the Madrid calendar date", () => {
            expect(madridToday(new Date("2026-10-06T22:30:00Z"))).toBe("2026-10-07");
        });
    });
});
