import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBearerToken } from "@/lib/mcp-auth";

const mockVerifyToken = vi.fn();
const mockFindUser = vi.fn();
const mockResolve = vi.fn();

vi.mock("@/lib/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jwt")>()),
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));
vi.mock("@/lib/access-tokens", () => ({
  ACCESS_TOKEN_PREFIX: "kb_",
  activeTokensWhere: vi.fn(),
  resolveAccessToken: (...args: unknown[]) => mockResolve(...args),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockFindUser(...args) } },
}));

const OPAQUE = `kb_${"A".repeat(43)}`;

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/mcp", { headers });
}

describe("validateBearerToken", () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockFindUser.mockReset();
    mockFindUser.mockResolvedValue({ tokenVersion: 0 });
    mockResolve.mockReset();
    mockResolve.mockResolvedValue(null);
  });

  describe("opaque access tokens (kb_…)", () => {
    it("returns the identity of a valid opaque access token without trying it as a JWT", async () => {
      mockResolve.mockResolvedValue({
        userId: "u1",
        tokenId: "t1",
        email: "agent@killbill.app",
        isAdmin: false,
        tokenVersion: 3,
      });
      const result = await validateBearerToken(makeRequest({ authorization: `Bearer ${OPAQUE}` }));
      expect(mockResolve).toHaveBeenCalledWith(OPAQUE);
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(result).toEqual({
        credential: "access-token",
        userId: "u1",
        email: "agent@killbill.app",
        isAdmin: false,
        tokenId: "t1",
        tokenVersion: 3,
      });
    });

    it("maps a null email to undefined", async () => {
      mockResolve.mockResolvedValue({ userId: "u1", tokenId: "t1", email: null, isAdmin: true, tokenVersion: 0 });
      const result = await validateBearerToken(makeRequest({ authorization: `Bearer ${OPAQUE}` }));
      expect(result).toMatchObject({ userId: "u1", email: undefined, isAdmin: true });
    });

    it("returns null when the token does not resolve (unknown, revoked, expired, guest)", async () => {
      expect(await validateBearerToken(makeRequest({ authorization: `Bearer ${OPAQUE}` }))).toBeNull();
      expect(mockResolve).toHaveBeenCalledWith(OPAQUE);
    });

    it("never falls back to the JWT path for a kb_ credential, even a malformed one", async () => {
      mockVerifyToken.mockResolvedValue({ userId: "u1", kind: "mcp", tv: 0 });
      expect(await validateBearerToken(makeRequest({ authorization: "Bearer kb_short" }))).toBeNull();
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });
  });

  it("does not look a JWT up as an access token", async () => {
    mockVerifyToken.mockResolvedValue({ userId: "u1", kind: "mcp", tv: 0 });
    expect(await validateBearerToken(makeRequest({ authorization: "Bearer mcp.jwt.token" }))).not.toBeNull();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("rejects the internal per-request MCP JWT (carries tid) as a Bearer", async () => {
    mockVerifyToken.mockResolvedValue({ userId: "u1", kind: "mcp", tv: 0, tid: "t1" });
    expect(await validateBearerToken(makeRequest({ authorization: "Bearer internal.jwt.token" }))).toBeNull();
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
      credential: "jwt",
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
      expect(await call()).toEqual({ credential: "jwt", userId: "u1", email: undefined, isAdmin: false });
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
