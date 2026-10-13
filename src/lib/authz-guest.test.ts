import { describe, it, expect } from "vitest";
import { guestRouteDecision, isGuestApiAllowed, isGuestPageAllowed, underPath } from "./authz-guest";

describe("underPath", () => {
    it("is segment-aware", () => {
        expect(underPath("/expense", "/expense")).toBe(true);
        expect(underPath("/expense/abc", "/expense")).toBe(true);
        expect(underPath("/expenses", "/expense")).toBe(false);
        expect(underPath("/guestbook", "/guest")).toBe(false);
    });
});

describe("guest pages", () => {
    it.each([
        "/dashboard", "/expenses/new", "/expenses/list", "/expense/e1", "/expense/e1/edit",
        "/settle", "/settle/s1", "/settle/s1/edit", "/settle/history", "/guest/upgrade",
        "/", "/login", "/register", "/i/tok",
    ])("allows %s", (p) => {
        expect(isGuestPageAllowed(p)).toBe(true);
        expect(guestRouteDecision(p, "GET")).toBe("allow");
    });

    it.each([
        "/categories", "/tags", "/spaces", "/spaces/abc", "/spaces/abc/close", "/spaces/new",
        "/settings", "/admin", "/month", "/lists", "/lists/l1", "/budget", "/analytics",
        "/personal", "/welcome", "/expenses/import", "/setup", "/dashboardx",
    ])("redirects %s to the dashboard", (p) => {
        expect(guestRouteDecision(p, "GET")).toBe("redirect");
    });
});

describe("guest API allowlist (deny by default)", () => {
    it.each([
        ["GET", "/api/expenses"],
        ["POST", "/api/expenses"],
        ["PATCH", "/api/expenses/e1"],
        ["DELETE", "/api/expenses/e1"],
        ["GET", "/api/expenses/e1/receipt-lines"],
        ["POST", "/api/expenses/e1/tags"],
        ["POST", "/api/upload"],
        ["POST", "/api/ocr"],
        ["GET", "/api/tags"],
        ["POST", "/api/settle"],
        ["PATCH", "/api/settle/s1"],
        ["PATCH", "/api/settle/s1/status"],
        ["GET", "/api/spaces/g1/balance"],
        ["GET", "/api/spaces/g1/categories"],
        ["POST", "/api/invites/claim"],
        ["GET", "/api/invites/tok/preview"],
        ["POST", "/api/guest/upgrade"],
        ["POST", "/api/auth/logout"],
    ])("allows %s %s", (method, path) => {
        expect(isGuestApiAllowed(path, method)).toBe(true);
        expect(guestRouteDecision(path, method)).toBe("allow");
    });

    it.each([
        // The QA escapes (IE-01, IE-08, SEC-01, T-02)
        ["POST", "/api/spaces"],
        ["GET", "/api/spaces"],
        ["PATCH", "/api/spaces/g1"],
        ["POST", "/api/spaces/g1/settle-up"],
        ["POST", "/api/spaces/g1/invites"],
        ["POST", "/api/spaces/g1/categories"],
        ["GET", "/api/spaces/g1/lists"],
        ["GET", "/api/me/lists"],
        ["POST", "/api/me/lists"],
        ["GET", "/api/me/categories"],
        ["GET", "/api/me/tokens"],
        ["POST", "/api/me/tokens"],
        ["DELETE", "/api/me/tokens/x"],
        ["POST", "/api/tags"],
        ["DELETE", "/api/tags/t1"],
        ["GET", "/api/budget"],
        ["POST", "/api/budget"],
        ["DELETE", "/api/budget"],
        ["PATCH", "/api/user/profile"],
        ["GET", "/api/couple"],
        ["POST", "/api/couple/unlink"],
        ["GET", "/api/export"],
        ["POST", "/api/expenses/import"],
        ["POST", "/api/expenses/recurring"],
        ["POST", "/api/expenses/e1/share"],
        ["GET", "/api/admin/invites"],
        ["POST", "/api/mcp"],
        ["POST", "/api/setup"],
        ["GET", "/api/something-new"],
        // wrong method on an allowed path
        ["DELETE", "/api/upload"],
        ["PUT", "/api/expenses"],
    ])("forbids %s %s", (method, path) => {
        expect(guestRouteDecision(path, method)).toBe("forbid");
    });

    it("is case-insensitive on the method", () => {
        expect(isGuestApiAllowed("/api/expenses", "post")).toBe(true);
    });
});
