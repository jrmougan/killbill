import { describe, it, expect } from "vitest";
import { accountJoinAllowed, mayOpenGuestSession, sessionKindOf } from "./invite-policy";

describe("accountJoinAllowed", () => {
    it("MEMBER links: only ACTIVE COUPLE/GROUP", () => {
        expect(accountJoinAllowed("MEMBER", "COUPLE", "ACTIVE")).toBe(true);
        expect(accountJoinAllowed("MEMBER", "GROUP", "ACTIVE")).toBe(true);
        expect(accountJoinAllowed("MEMBER", "EPHEMERAL", "ACTIVE")).toBe(false);
        expect(accountJoinAllowed("MEMBER", "GROUP", "SETTLING")).toBe(false);
        expect(accountJoinAllowed("MEMBER", "GROUP", "ARCHIVED")).toBe(false);
    });

    it("GUEST links: a registered account may join the ACTIVE trip", () => {
        expect(accountJoinAllowed("GUEST", "EPHEMERAL", "ACTIVE")).toBe(true);
        expect(accountJoinAllowed("GUEST", "EPHEMERAL", "SETTLING")).toBe(false);
        expect(accountJoinAllowed("GUEST", "GROUP", "ACTIVE")).toBe(false);
    });
});

describe("sessionKindOf", () => {
    it("classifies sessions", () => {
        expect(sessionKindOf(null)).toBe("none");
        expect(sessionKindOf({})).toBe("none");
        expect(sessionKindOf({ userId: "u1" })).toBe("registered");
        expect(sessionKindOf({ userId: "g1", kind: "guest" })).toBe("guest");
        expect(sessionKindOf({ userId: "u1", kind: "mcp" })).toBe("none");
    });
});

describe("mayOpenGuestSession", () => {
    it("never silently replaces a registered session", () => {
        expect(mayOpenGuestSession("registered", false)).toBe(false);
        expect(mayOpenGuestSession("registered", true)).toBe(true);
        expect(mayOpenGuestSession("none", false)).toBe(true);
        expect(mayOpenGuestSession("guest", false)).toBe(true);
    });
});
