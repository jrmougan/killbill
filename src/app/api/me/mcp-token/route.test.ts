import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockSignMcpToken = vi.fn();
const mockFindUser = vi.fn();
const originalTtl = process.env.MCP_TOKEN_TTL_DAYS;

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => mockFindUser(...a) } } }));
vi.mock("@/lib/jwt", () => ({ signMcpToken: (...args: unknown[]) => mockSignMcpToken(...args) }));

import { POST } from "./route";

describe("POST /api/me/mcp-token", () => {
  beforeEach(() => {
    mockGetSessionCtx.mockReset();
    mockSignMcpToken.mockReset();
    mockFindUser.mockReset();
    delete process.env.MCP_TOKEN_TTL_DAYS;
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", isAdmin: false, tokenVersion: 2 });
    mockFindUser.mockResolvedValue({ email: "user@example.com", isAdmin: false, tokenVersion: 2 });
    mockSignMcpToken.mockResolvedValue("mcp.jwt.token");
  });

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.MCP_TOKEN_TTL_DAYS;
    else process.env.MCP_TOKEN_TTL_DAYS = originalTtl;
  });

  it("returns 401 without a session", async () => {
    mockGetSessionCtx.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mockSignMcpToken).not.toHaveBeenCalled();
  });

  it("returns 403 for a guest session", async () => {
    mockGetSessionCtx.mockResolvedValue({ userId: "guest-1", kind: "guest" });

    const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mockSignMcpToken).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is itself an MCP token", async () => {
    mockGetSessionCtx.mockResolvedValue({ userId: "user-1", kind: "mcp" });

    const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mockSignMcpToken).not.toHaveBeenCalled();
  });

  it("issues a no-store MCP token for a normal browser session", async () => {
    const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.token).toBe("mcp.jwt.token");
    expect(body.expiresInDays).toBe(90);
    expect(mockSignMcpToken).toHaveBeenCalledWith(
      { userId: "user-1", email: "user@example.com", isAdmin: false, tv: 2 },
      90,
    );
  });

  it.each(["0", "1.5", "invalid", "366"]) 
    ("uses the default TTL for invalid value %s", async (ttl) => {
      process.env.MCP_TOKEN_TTL_DAYS = ttl;

      const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));
      const body = await response.json();

      expect(body.expiresInDays).toBe(90);
      expect(mockSignMcpToken).toHaveBeenLastCalledWith(expect.any(Object), 90);
    });

  it("returns a generic 500 response when signing fails", async () => {
    mockSignMcpToken.mockRejectedValue(new Error("signing secret unavailable"));

    const response = await POST(new Request("http://localhost/api/me/mcp-token", { method: "POST" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "No se pudo generar el token" });
  });
});
