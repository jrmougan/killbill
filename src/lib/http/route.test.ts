import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { NextResponse } from "next/server";

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockUserFindUnique = vi.fn();
const mockRateLimit = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => mockGetSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

import { route } from "./route";
import { requireSpace, enforceRateLimit } from "./guards";
import { HttpError } from "./errors";

const ok = () => NextResponse.json({ ok: true });
const post = (body?: string, url = "http://localhost/api/x") =>
    new Request(url, { method: "POST", ...(body !== undefined ? { body } : {}) });

describe("route() auth modes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    });

    it("user: 401 'No autorizado' without a session (custom message allowed)", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await route({ auth: "user" }, ok)(post());
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "No autorizado" });
        const legacy = await route({ auth: "user", unauthorizedMessage: "Unauthorized" }, ok)(post());
        expect(await legacy.json()).toEqual({ error: "Unauthorized" });
    });

    it("user: guests get 403 (configurable message); user-or-guest lets them through", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        const res = await route({ auth: "user" }, ok)(post());
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Acción no permitida para invitados" });
        const custom = await route({ auth: "user", guestMessage: "Nope" }, ok)(post());
        expect(await custom.json()).toEqual({ error: "Nope" });
        const handler = vi.fn((_args: unknown) => ok());
        expect((await route({ auth: "user-or-guest" }, handler)(post())).status).toBe(200);
        expect((handler.mock.calls[0][0] as { ctx: unknown }).ctx).toEqual({ userId: "g1", kind: "guest", groupId: "trip" });
    });

    it("public: no session needed, ctx is null", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const handler = vi.fn((_args: unknown) => ok());
        expect((await route({ auth: "public" }, handler)(post())).status).toBe(200);
        expect((handler.mock.calls[0][0] as { ctx: unknown }).ctx).toBeNull();
    });

    it("admin: isAdmin read from the DB; MCP/guest sessions are 401; non-admin 403", async () => {
        const h = route({ auth: "admin" }, ok);
        mockUserFindUnique.mockResolvedValue({ isAdmin: true });
        expect((await h(post())).status).toBe(200);
        expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: "u1" }, select: { isAdmin: true } });

        mockUserFindUnique.mockResolvedValue({ isAdmin: false });
        const denied = await h(post());
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: "Acceso denegado" });

        mockUserFindUnique.mockResolvedValue(null);
        expect((await h(post())).status).toBe(401);

        mockGetSessionCtx.mockResolvedValue({ userId: "u1", kind: "mcp", isAdmin: true });
        expect((await h(post())).status).toBe(401);
    });
});

describe("route() parsing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    });

    it("passes typed body, query and params to the handler", async () => {
        const handler = vi.fn((_args: unknown) => ok());
        const h = route({
            auth: "user",
            body: z.object({ name: z.string() }),
            query: z.object({ scope: z.string().optional() }),
            params: z.object({ id: z.string() }),
        }, handler);
        const res = await h(post('{"name":"x","extra":1}', "http://localhost/api/x?scope=p"), { params: Promise.resolve({ id: "e1" }) });
        expect(res.status).toBe(200);
        expect(handler.mock.calls[0][0]).toMatchObject({ body: { name: "x" }, query: { scope: "p" }, params: { id: "e1" } });
    });

    it("untyped params default to the raw segment values; missing context → {}", async () => {
        const handler = vi.fn((_args: unknown) => ok());
        await route({ auth: "user" }, handler)(post(), { params: Promise.resolve({ id: "e9" }) });
        expect(handler.mock.calls[0][0]).toMatchObject({ params: { id: "e9" }, body: undefined, query: undefined });
        await route({ auth: "user" }, handler)(post());
        expect(handler.mock.calls[1][0]).toMatchObject({ params: {} });
    });

    it("auth runs BEFORE body parsing (401 wins over a bad body)", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await route({ auth: "user", body: z.object({ a: z.number() }) }, ok)(post("{bad"));
        expect(res.status).toBe(401);
    });

    it("invalid JSON / invalid body → 400 and the handler never runs", async () => {
        const handler = vi.fn(ok);
        const h = route({ auth: "user", body: z.object({ a: z.number({ error: "Falta a" }) }) }, handler);
        const bad = await h(post("{bad"));
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: "Petición no válida" });
        const invalid = await h(post("{}"));
        expect(await invalid.json()).toEqual({ error: "Falta a", issues: [{ path: "a", message: "Falta a" }] });
        expect(handler).not.toHaveBeenCalled();
    });

    it("bodyOptions: custom invalid-JSON message and validation code", async () => {
        const handler = vi.fn(ok);
        const h = route(
            {
                auth: "user",
                body: z.object({ a: z.number({ error: "Falta a" }) }),
                bodyOptions: { invalidMessage: "Cuerpo inválido", code: "INVALID_INPUT" },
            },
            handler,
        );
        expect(await (await h(post("{bad"))).json()).toEqual({ error: "Cuerpo inválido" });
        expect(await (await h(post("{}"))).json()).toEqual({
            error: "Falta a",
            code: "INVALID_INPUT",
            issues: [{ path: "a", message: "Falta a" }],
        });
        expect(handler).not.toHaveBeenCalled();
    });

    it("maps thrown errors; unknown ones become the route's 500", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const conflictRes = await route({ auth: "user" }, () => { throw new HttpError(409, "Ya existe", "DUP"); })(post());
        expect(conflictRes.status).toBe(409);
        expect(await conflictRes.json()).toEqual({ error: "Ya existe", code: "DUP" });
        const crash = await route({ auth: "user", errorMessage: "Error al guardar" }, () => { throw new Error("x"); })(post());
        expect(crash.status).toBe(500);
        expect(await crash.json()).toEqual({ error: "Error al guardar" });
        spy.mockRestore();
    });
});

describe("guards", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requireSpace returns the access or throws its denial verbatim", async () => {
        mockRequireSpaceAccess.mockResolvedValue({ ok: true, userId: "u1", role: "OWNER" });
        expect(await requireSpace({ userId: "u1" }, "g1", { allowGuest: true })).toMatchObject({ role: "OWNER" });
        expect(mockRequireSpaceAccess).toHaveBeenCalledWith({ userId: "u1" }, "g1", { allowGuest: true });

        mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 409, error: "Archivado", code: "SPACE_NOT_WRITABLE" });
        await expect(requireSpace({ userId: "u1" }, "g1")).rejects.toMatchObject({ status: 409, message: "Archivado", code: "SPACE_NOT_WRITABLE" });
    });

    it("enforceRateLimit throws a 429 with Retry-After", () => {
        mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
        expect(() => enforceRateLimit("k", 1, 1000)).not.toThrow();
        mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 12 });
        try {
            enforceRateLimit("k", 1, 1000);
            throw new Error("no throw");
        } catch (e) {
            expect(e).toBeInstanceOf(HttpError);
            expect((e as HttpError).status).toBe(429);
            expect((e as HttpError).headers).toEqual({ "Retry-After": "12" });
            expect((e as HttpError).message).toBe("Demasiadas solicitudes. Inténtalo de nuevo más tarde.");
        }
    });
});
