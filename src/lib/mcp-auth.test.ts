import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBearerToken } from "@/lib/mcp-auth";

const mockResolve = vi.fn();
const mockFindToken = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { accessToken: { findUnique: (...args: unknown[]) => mockFindToken(...args) } },
}));

vi.mock("@/lib/access-tokens", () => ({
  resolveAccessToken: (...args: unknown[]) => mockResolve(...args),
}));

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/mcp", { headers });
}

const OPAQUE = `kb_${"A".repeat(43)}`;

describe("validateBearerToken", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockResolve.mockResolvedValue(null);
  });

  it("returns null without touching the DB when there is no usable Bearer", async () => {
    expect(await validateBearerToken(makeRequest())).toBeNull();
    expect(await validateBearerToken(makeRequest({ authorization: "Basic abc123" }))).toBeNull();
    expect(await validateBearerToken(makeRequest({ authorization: "Bearer " }))).toBeNull();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("returns the identity of a valid opaque access token", async () => {
    mockResolve.mockResolvedValue({
      userId: "u1",
      tokenId: "t1",
      email: "agent@killbill.app",
      isAdmin: false,
      tokenVersion: 3,
    });
    const result = await validateBearerToken(makeRequest({ authorization: `Bearer ${OPAQUE}` }));
    expect(mockResolve).toHaveBeenCalledWith(OPAQUE);
    expect(result).toEqual({
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
  });

  it("rejects any JWT (session, guest or legacy MCP) as a Bearer", async () => {
    // A JWT is not an opaque token: resolveAccessToken rejects its format.
    const { resolveAccessToken } = await vi.importActual<typeof import("@/lib/access-tokens")>("@/lib/access-tokens");
    mockResolve.mockImplementation(resolveAccessToken);
    process.env.JWT_SECRET = "test-secret-for-vitest";
    const { signToken, signGuestToken, signInternalMcpToken } = await import("@/lib/jwt");
    const jwts = [
      await signToken({ userId: "u1", tv: 0 }),
      await signGuestToken({ userId: "g1", groupId: "s1", role: "GUEST" }),
      await signInternalMcpToken({ userId: "u1", tv: 0, tid: "t1" }),
    ];
    for (const jwt of jwts) {
      expect(await validateBearerToken(makeRequest({ authorization: `Bearer ${jwt}` }))).toBeNull();
    }
    expect(mockFindToken).not.toHaveBeenCalled();
  });
});
