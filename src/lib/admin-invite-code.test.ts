import { describe, expect, it } from "vitest";
import { isAdminInviteCode } from "./admin-invite-code";
import { generateInviteToken } from "./invite-token";

describe("isAdminInviteCode", () => {
    it("accepts the 8-hex codes the admin panel creates, in any case", () => {
        expect(isAdminInviteCode("A1B2C3D4")).toBe(true);
        expect(isAdminInviteCode("a1b2c3d4")).toBe(true);
    });

    it("rejects anything else, including a space invitation token", () => {
        expect(isAdminInviteCode(null)).toBe(false);
        expect(isAdminInviteCode("")).toBe(false);
        expect(isAdminInviteCode("A1B2C3")).toBe(false);
        expect(isAdminInviteCode("A1B2C3D4E")).toBe(false);
        expect(isAdminInviteCode("G1B2C3D4")).toBe(false);
        expect(isAdminInviteCode(" A1B2C3D4")).toBe(false);
        expect(isAdminInviteCode(generateInviteToken())).toBe(false);
    });
});
