// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockReplace = vi.fn();
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
    HERMES_TOKEN_NAME: "Hermes Agent",
    HERMES_TOKEN_DAYS: 90,
    replaceNamedAccessToken: (...a: unknown[]) => mockReplace(...a),
  };
});

import { AccessTokenError } from "@/lib/access-tokens";
import { POST } from "./route";

const TOKEN = "kb_" + "x".repeat(43);
const summary = {
  id: "tok-1",
  name: "Hermes Agent",
  prefix: "kb_xxxxxxxx",
  createdAt: "2026-10-07T10:00:00.000Z",
  lastUsedAt: null,
  expiresAt: "2027-01-05T10:00:00.000Z",
  status: "active" as const,
};

const post = () => POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));

describe("POST /api/me/mcp-token", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", isAdmin: false, tokenVersion: 2 });
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockReplace.mockResolvedValue({ token: TOKEN, summary, replaced: 1 });
  });

  it("returns 401 without a session", async () => {
    mockGetSessionCtx.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(401);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("returns 403 for a guest session", async () => {
    mockGetSessionCtx.mockResolvedValue({ userId: "guest-1", kind: "guest" });

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Acción no permitida con este tipo de sesión" });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is itself an MCP token", async () => {
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", kind: "mcp" });

    const response = await post();

    expect(response.status).toBe(403);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("creates a 90-day «Hermes Agent» access token that replaces the previous one (no-store)", async () => {
    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockReplace).toHaveBeenCalledWith("user-1", { name: "Hermes Agent", expiresInDays: 90 });
    // Historical fields (token, expiresInDays, expiresAt) plus the token summary.
    expect(body).toEqual({ token: TOKEN, ...summary, expiresInDays: 90, replaced: 1 });
  });

  it("shares the access-token creation rate limit (429)", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

    const response = await post();

    expect(response.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith("access-token:user-1", 10, 60 * 60 * 1000);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("maps 409 TOKEN_LIMIT", async () => {
    mockReplace.mockRejectedValue(new AccessTokenError(409, "TOKEN_LIMIT", "Has alcanzado el máximo"));

    const response = await post();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Has alcanzado el máximo", code: "TOKEN_LIMIT" });
  });

  it("returns a generic 500 response when creating fails", async () => {
    mockReplace.mockRejectedValue(new Error("db down"));

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "No se pudo generar el token" });
  });
});
