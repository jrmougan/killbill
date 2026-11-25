import { describe, expect, it } from "vitest";
import { inviteConfigFor } from "./invite-eligibility";

const base = { type: "COUPLE", status: "ACTIVE", role: "OWNER", memberCount: 1 };

describe("inviteConfigFor", () => {
    it("offers a single-use member link to a waiting couple", () => {
        expect(inviteConfigFor(base, false)).toEqual({ kind: "MEMBER", maxUses: 1 });
    });
    it("hides the card for a full couple, plain members and closed spaces", () => {
        expect(inviteConfigFor({ ...base, memberCount: 2 }, false)).toBeNull();
        expect(inviteConfigFor({ ...base, role: "MEMBER" }, false)).toBeNull();
        expect(inviteConfigFor({ ...base, status: "SETTLING" }, false)).toBeNull();
    });
    it("caps group links by the room left", () => {
        expect(inviteConfigFor({ ...base, type: "GROUP", memberCount: 3 }, false)).toEqual({ kind: "MEMBER", maxUses: 10 });
        expect(inviteConfigFor({ ...base, type: "GROUP", memberCount: 18 }, false)).toEqual({ kind: "MEMBER", maxUses: 2 });
    });
    it("only offers guest links for ephemeral spaces behind the flag", () => {
        expect(inviteConfigFor({ ...base, type: "EPHEMERAL" }, false)).toBeNull();
        expect(inviteConfigFor({ ...base, type: "EPHEMERAL" }, true)).toEqual({ kind: "GUEST", maxUses: 10 });
    });
});
