// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockCreate = vi.fn();
const mockList = vi.fn();
const mockRateLimit = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }));
vi.mock("@/lib/access-tokens", () => {
    class AccessTokenError extends Error {
        status: number;
        code: string;
        constructor(status: number, code: string, message: string) {
            super(message);
            this.name = "AccessTokenError";
            this.status = status;
            this.code = code;
        }
    }
    return {
        AccessTokenError,
        createAccessToken: (...a: unknown[]) => mockCreate(...a),
        listAccessTokens: (...a: unknown[]) => mockList(...a),
    };
});

import { AccessTokenError } from "@/lib/access-tokens";
import { GET, POST } from "./route";

const summary = {
    id: "tok-1",
    name: "Portátil",
    prefix: "kb_AbCdEfGh",
    createdAt: "2026-10-07T10:00:00.000Z",
    lastUsedAt: null,
    expiresAt: "2027-01-05T10:00:00.000Z",
    status: "active" as const,
};

function post(body: unknown) {
    return POST(
        new Request("http://localhost/api/me/tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: typeof body === "string" ? body : JSON.stringify(body),
        }),
    );
}

function get() {
    return GET(new Request("http://localhost/api/me/tokens"));
}

beforeEach(() => {
    vi.resetAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", isAdmin: false });
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockCreate.mockResolvedValue({ token: "kb_" + "x".repeat(43), summary });
    mockList.mockResolvedValue([summary]);
});

describe.each([
    ["GET", () => get()],
    ["POST", () => post({ name: "Portátil", expiresInDays: 90 })],
] as const)("%s /api/me/tokens session gate", (_method, call) => {
    it("returns 401 without a session", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await call();
        expect(res.status).toBe(401);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockList).not.toHaveBeenCalled();
    });

    it.each(["guest", "mcp"])("returns 403 for a %s session", async (kind) => {
        mockGetSessionCtx.mockResolvedValue({ userId: "user-1", kind });
        const res = await call();
        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toEqual({ error: "Acción no permitida con este tipo de sesión" });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockList).not.toHaveBeenCalled();
        expect(mockRateLimit).not.toHaveBeenCalled();
    });
});

describe("GET /api/me/tokens", () => {
    it("lists the caller's tokens with no-store", async () => {
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        await expect(res.json()).resolves.toEqual({ tokens: [summary] });
        expect(mockList).toHaveBeenCalledWith("user-1");
    });
});

describe("POST /api/me/tokens", () => {
    it("creates a token and returns it once with no-store", async () => {
        const res = await post({ name: "  Portátil  ", expiresInDays: 90 });
        expect(res.status).toBe(201);
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        await expect(res.json()).resolves.toEqual({ token: "kb_" + "x".repeat(43), ...summary });
        expect(mockCreate).toHaveBeenCalledWith("user-1", { name: "Portátil", expiresInDays: 90 });
        expect(mockRateLimit).toHaveBeenCalledWith("access-token:user-1", 10, 60 * 60 * 1000);
    });

    it.each([30, 90, 365])("accepts a %i-day duration", async (days) => {
        const res = await post({ name: "CLI", expiresInDays: days });
        expect(res.status).toBe(201);
        expect(mockCreate).toHaveBeenCalledWith("user-1", { name: "CLI", expiresInDays: days });
    });

    it("accepts null as 'sin caducidad'", async () => {
        mockCreate.mockResolvedValue({ token: "kb_tok", summary: { ...summary, expiresAt: null } });
        const res = await post({ name: "Servidor", expiresInDays: null });
        expect(res.status).toBe(201);
        expect((await res.json()).expiresAt).toBeNull();
        expect(mockCreate).toHaveBeenCalledWith("user-1", { name: "Servidor", expiresInDays: null });
    });

    it.each([
        [{ expiresInDays: 90 }, "El nombre es obligatorio"],
        [{ name: 42, expiresInDays: 90 }, "El nombre es obligatorio"],
        [{ name: "   ", expiresInDays: 90 }, "El nombre es obligatorio"],
        [{ name: "x".repeat(61), expiresInDays: 90 }, "El nombre es demasiado largo"],
        [{ name: "CLI" }, "Duración no válida"],
        [{ name: "CLI", expiresInDays: 7 }, "Duración no válida"],
        [{ name: "CLI", expiresInDays: "90" }, "Duración no válida"],
        [{ name: "CLI", expiresInDays: 0 }, "Duración no válida"],
    ])("rejects %j with 400 %s", async (body, message) => {
        const res = await post(body);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(message);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("accepts a name of exactly 60 characters", async () => {
        const res = await post({ name: "x".repeat(60), expiresInDays: 30 });
        expect(res.status).toBe(201);
    });

    it("rejects an invalid JSON body", async () => {
        const res = await post("{not json");
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({ error: "Petición no válida" });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 409 TOKEN_LIMIT when the active-token cap is reached", async () => {
        const message = "Has alcanzado el máximo de 20 tokens activos. Revoca alguno antes de crear otro.";
        mockCreate.mockRejectedValue(new AccessTokenError(409, "TOKEN_LIMIT", message));
        const res = await post({ name: "CLI", expiresInDays: 90 });
        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toEqual({ error: message, code: "TOKEN_LIMIT" });
    });

    it("returns 429 with Retry-After when rate limited, before touching the DB", async () => {
        mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 120 });
        const res = await post({ name: "CLI", expiresInDays: 90 });
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("120");
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns a generic 500 when creation fails unexpectedly", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        mockCreate.mockRejectedValue(new Error("db down"));
        const res = await post({ name: "CLI", expiresInDays: 90 });
        expect(res.status).toBe(500);
        await expect(res.json()).resolves.toEqual({ error: "No se pudo generar el token" });
        spy.mockRestore();
    });
});
