import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBearerToken } from "@/lib/mcp-auth";

const mockVerifyToken = vi.fn();
const mockFindUser = vi.fn();

vi.mock("@/lib/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jwt")>()),
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockFindUser(...args) } },
}));

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/mcp", { headers });
}

describe("validateBearerToken", () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockFindUser.mockReset();
    mockFindUser.mockResolvedValue({ tokenVersion: 0 });
  });

  it("returns null when no Authorization header is present", async () => {
    const result = await validateBearerToken(makeRequest());
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null for non-Bearer schemes", async () => {
    const result = await validateBearerToken(
      makeRequest({ authorization: "Basic abc123" }),
    );
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null for an empty token", async () => {
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer " }),
    );
    expect(result).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when verifyToken returns null", async () => {
    mockVerifyToken.mockResolvedValue(null);
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer invalid.jwt.token" }),
    );
    expect(result).toBeNull();
  });

  it("returns null when payload has no userId", async () => {
    mockVerifyToken.mockResolvedValue({ email: "test@test.com" });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer some.jwt.token" }),
    );
    expect(result).toBeNull();
  });

  it("returns null for guest tokens", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-1",
      kind: "guest",
      groupId: "group-1",
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer guest.jwt.token" }),
    );
    expect(result).toBeNull();
  });

  it("returns null for a regular browser token", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-123",
      email: "test@test.com",
      isAdmin: true,
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer valid.jwt.token" }),
    );
    expect(result).toBeNull();
  });

  it("returns identity for an MCP-kind token", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-456",
      email: "agent@killbill.app",
      isAdmin: false,
      kind: "mcp",
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer mcp.jwt.token" }),
    );
    expect(result).toEqual({
      userId: "user-456",
      email: "agent@killbill.app",
      isAdmin: false,
    });
  });

  it("returns null for a token without an MCP kind", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-789",
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer minimal.jwt.token" }),
    );
    expect(result).toBeNull();
  });

  describe("token revocation (tokenVersion)", () => {
    const mcp = (extra: Record<string, unknown> = {}) => ({ userId: "u1", kind: "mcp", ...extra });
    const call = () => validateBearerToken(makeRequest({ authorization: "Bearer mcp.jwt.token" }));

    it("accepts a token whose tv matches the DB", async () => {
      mockVerifyToken.mockResolvedValue(mcp({ tv: 3 }));
      mockFindUser.mockResolvedValue({ tokenVersion: 3 });
      expect(await call()).toEqual({ userId: "u1", email: undefined, isAdmin: false });
      expect(mockFindUser).toHaveBeenCalledWith({ where: { id: "u1" }, select: { tokenVersion: true } });
    });

    it("rejects a token whose tv is stale (revoked)", async () => {
      mockVerifyToken.mockResolvedValue(mcp({ tv: 0 }));
      mockFindUser.mockResolvedValue({ tokenVersion: 1 });
      expect(await call()).toBeNull();
    });

    it("accepts a legacy token without tv while the user is still at version 0", async () => {
      mockVerifyToken.mockResolvedValue(mcp());
      mockFindUser.mockResolvedValue({ tokenVersion: 0 });
      expect(await call()).not.toBeNull();
    });

    it("rejects a legacy token without tv once the user revoked their tokens", async () => {
      mockVerifyToken.mockResolvedValue(mcp());
      mockFindUser.mockResolvedValue({ tokenVersion: 1 });
      expect(await call()).toBeNull();
    });

    it("rejects a malformed tv claim and a deleted user", async () => {
      mockVerifyToken.mockResolvedValue(mcp({ tv: "0" }));
      expect(await call()).toBeNull();
      mockVerifyToken.mockResolvedValue(mcp({ tv: 0 }));
      mockFindUser.mockResolvedValue(null);
      expect(await call()).toBeNull();
    });
  });
});
