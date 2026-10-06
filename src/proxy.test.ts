// @vitest-environment node
// jose's Uint8Array checks fail under jsdom (cross-realm typed arrays).
import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { signToken, signGuestToken } from "@/lib/jwt";

const BASE = "http://localhost:3000";

function req(path: string, method = "GET", token?: string) {
    const headers = new Headers();
    if (token) headers.set("cookie", `session_token=${token}`);
    return new NextRequest(new URL(path, BASE), { method, headers });
}

let guest: string;
let member: string;

beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret-for-proxy";
    guest = await signGuestToken({ userId: "g1", groupId: "trip", role: "GUEST" }, new Date(Date.now() + 86_400_000));
    member = await signToken({ userId: "u1" });
});

describe("proxy — guest confinement", () => {
    it.each([
        ["POST", "/api/spaces"],
        ["POST", "/api/me/lists"],
        ["POST", "/api/tags"],
        ["DELETE", "/api/budget"],
        ["PATCH", "/api/user/profile"],
    ])("403 for a guest on %s %s", async (method, path) => {
        const res = await proxy(req(path, method, guest));
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("Acción no permitida para invitados");
    });

    it.each(["/categories", "/tags", "/spaces/trip", "/settings"])("redirects a guest away from %s", async (path) => {
        const res = await proxy(req(path, "GET", guest));
        expect(res.status).toBe(307);
        expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    });

    it("lets a guest through its surface and slides the session cookie", async () => {
        const res = await proxy(req("/api/expenses", "POST", guest));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-middleware-next")).toBe("1");
        expect(res.cookies.get("session_token")?.value).toBeTruthy();
    });
});

describe("proxy — registered and anonymous", () => {
    it("does not restrict a registered session", async () => {
        const res = await proxy(req("/api/spaces", "POST", member));
        expect(res.headers.get("x-middleware-next")).toBe("1");
        const page = await proxy(req("/categories", "GET", member));
        expect(page.headers.get("x-middleware-next")).toBe("1");
    });

    it("sends anonymous visitors of protected pages to /login", async () => {
        const res = await proxy(req("/spaces/abc"));
        expect(res.status).toBe(307);
        expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    });

    it("401s anonymous admin API calls", async () => {
        expect((await proxy(req("/api/admin/invites"))).status).toBe(401);
    });

    it("keeps /i/* public and stamps no-referrer", async () => {
        const res = await proxy(req("/i/sometoken"));
        expect(res.headers.get("x-middleware-next")).toBe("1");
        expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("lets anonymous visitors reach public pages (/register)", async () => {
        const res = await proxy(req("/register"));
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
});
