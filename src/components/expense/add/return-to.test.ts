import { describe, it, expect } from "vitest";
import { safeReturnTo } from "@/lib/safe-return";

/**
 * G-01/T-01: every `returnTo` of the add/edit expense flow goes through
 * safeReturnTo (server page AND client close/save). These are the QA vectors.
 */
describe("returnTo of /expenses/new (open redirect)", () => {
    it.each([
        "/\t/evil.com",
        "/\n/evil.com",
        "/\r/evil.com",
        decodeURIComponent("/%09/evil.com"),
        decodeURIComponent("/%0a/evil.com"),
        "//evil.com",
        "/\\evil.com",
        "\\/evil.com",
        "https://evil.com",
        "javascript:alert(1)",
        "evil.com",
        " /dashboard",
        "",
    ])("rejects %j", (raw) => {
        expect(safeReturnTo(raw)).toBeNull();
    });

    it.each([
        ["/dashboard", "/dashboard"],
        ["/dashboard?scope=personal", "/dashboard?scope=personal"],
        ["/lists/abc#x", "/lists/abc#x"],
        ["/expenses/list", "/expenses/list"],
    ])("keeps the in-app path %j", (raw, out) => {
        expect(safeReturnTo(raw)).toBe(out);
    });
});
