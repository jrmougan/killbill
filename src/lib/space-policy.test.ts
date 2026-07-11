import { describe, it, expect } from "vitest";
import {
    SPACE_CAPS,
    capFor,
    allowsGuests,
    allowsBudgetsAndRecurring,
    allowsCustomCategories,
    joinByCodeAllowed,
    isSpaceWritable,
    assertSpaceWritable,
    canTransitionStatus,
    assertStatusTransition,
    canUpgradeType,
    assertTypeUpgrade,
    assertHasRoom,
    SpacePolicyError,
} from "./space-policy";
import { MAX_GROUP_MEMBERS } from "./membership";

describe("space-policy", () => {
    describe("SPACE_CAPS", () => {
        it("caps COUPLE at 2 and GROUP/EPHEMERAL at MAX_GROUP_MEMBERS", () => {
            expect(SPACE_CAPS.COUPLE).toBe(2);
            expect(SPACE_CAPS.GROUP).toBe(MAX_GROUP_MEMBERS);
            expect(SPACE_CAPS.EPHEMERAL).toBe(MAX_GROUP_MEMBERS);
            expect(SPACE_CAPS.INDIVIDUAL).toBe(1);
            expect(capFor("COUPLE")).toBe(2);
        });
    });

    describe("allowsGuests", () => {
        it("allows guests only in EPHEMERAL", () => {
            expect(allowsGuests("EPHEMERAL")).toBe(true);
            expect(allowsGuests("GROUP")).toBe(false);
            expect(allowsGuests("COUPLE")).toBe(false);
            expect(allowsGuests("INDIVIDUAL")).toBe(false);
        });
    });

    describe("allowsBudgetsAndRecurring", () => {
        it("vetoes budgets/recurring in EPHEMERAL only", () => {
            expect(allowsBudgetsAndRecurring("EPHEMERAL")).toBe(false);
            expect(allowsBudgetsAndRecurring("GROUP")).toBe(true);
            expect(allowsBudgetsAndRecurring("COUPLE")).toBe(true);
        });
    });

    describe("allowsCustomCategories", () => {
        it("permits custom categories in every space type", () => {
            expect(allowsCustomCategories("COUPLE")).toBe(true);
            expect(allowsCustomCategories("GROUP")).toBe(true);
            expect(allowsCustomCategories("EPHEMERAL")).toBe(true);
            expect(allowsCustomCategories("INDIVIDUAL")).toBe(true);
        });
    });

    describe("joinByCodeAllowed", () => {
        it("allows join-by-code only for ACTIVE COUPLE/GROUP", () => {
            expect(joinByCodeAllowed("COUPLE", "ACTIVE")).toBe(true);
            expect(joinByCodeAllowed("GROUP", "ACTIVE")).toBe(true);
        });
        it("rejects EPHEMERAL and INDIVIDUAL", () => {
            expect(joinByCodeAllowed("EPHEMERAL", "ACTIVE")).toBe(false);
            expect(joinByCodeAllowed("INDIVIDUAL", "ACTIVE")).toBe(false);
        });
        it("rejects non-ACTIVE statuses", () => {
            expect(joinByCodeAllowed("GROUP", "SETTLING")).toBe(false);
            expect(joinByCodeAllowed("GROUP", "ARCHIVED")).toBe(false);
        });
    });

    describe("writability", () => {
        it("is writable only when ACTIVE", () => {
            expect(isSpaceWritable("ACTIVE")).toBe(true);
            expect(isSpaceWritable("SETTLING")).toBe(false);
            expect(isSpaceWritable("ARCHIVED")).toBe(false);
        });
        it("assertSpaceWritable throws SpacePolicyError for non-ACTIVE", () => {
            expect(() => assertSpaceWritable("ACTIVE")).not.toThrow();
            expect(() => assertSpaceWritable("SETTLING")).toThrow(SpacePolicyError);
            try {
                assertSpaceWritable("ARCHIVED");
            } catch (e) {
                expect(e).toBeInstanceOf(SpacePolicyError);
                expect((e as SpacePolicyError).code).toBe("SPACE_NOT_WRITABLE");
                expect((e as SpacePolicyError).status).toBe(409);
            }
        });
    });

    describe("status transitions", () => {
        it("allows ACTIVE<->SETTLING and ->ARCHIVED", () => {
            expect(canTransitionStatus("ACTIVE", "SETTLING")).toBe(true);
            expect(canTransitionStatus("SETTLING", "ACTIVE")).toBe(true);
            expect(canTransitionStatus("ACTIVE", "ARCHIVED")).toBe(true);
            expect(canTransitionStatus("SETTLING", "ARCHIVED")).toBe(true);
        });
        it("makes ARCHIVED terminal", () => {
            expect(canTransitionStatus("ARCHIVED", "ACTIVE")).toBe(false);
            expect(canTransitionStatus("ARCHIVED", "SETTLING")).toBe(false);
        });
        it("assertStatusTransition rejects identity and illegal moves", () => {
            expect(() => assertStatusTransition("ACTIVE", "ACTIVE")).toThrow(SpacePolicyError);
            expect(() => assertStatusTransition("ARCHIVED", "ACTIVE")).toThrow(SpacePolicyError);
            expect(() => assertStatusTransition("ACTIVE", "SETTLING")).not.toThrow();
        });
    });

    describe("type upgrade", () => {
        it("only permits COUPLE -> GROUP", () => {
            expect(canUpgradeType("COUPLE", "GROUP")).toBe(true);
            expect(canUpgradeType("GROUP", "COUPLE")).toBe(false);
            expect(canUpgradeType("COUPLE", "EPHEMERAL")).toBe(false);
            expect(canUpgradeType("GROUP", "EPHEMERAL")).toBe(false);
        });
        it("assertTypeUpgrade throws on illegal upgrade", () => {
            expect(() => assertTypeUpgrade("COUPLE", "GROUP")).not.toThrow();
            expect(() => assertTypeUpgrade("GROUP", "EPHEMERAL")).toThrow(SpacePolicyError);
        });
    });

    describe("assertHasRoom", () => {
        it("throws SPACE_FULL at the cap", () => {
            expect(() => assertHasRoom("COUPLE", 1)).not.toThrow();
            expect(() => assertHasRoom("COUPLE", 2)).toThrow(SpacePolicyError);
            expect(() => assertHasRoom("GROUP", MAX_GROUP_MEMBERS - 1)).not.toThrow();
            try {
                assertHasRoom("GROUP", MAX_GROUP_MEMBERS);
            } catch (e) {
                expect((e as SpacePolicyError).code).toBe("SPACE_FULL");
            }
        });
    });
});
