import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBearerToken } from "@/lib/mcp-auth";

const mockVerifyToken = vi.fn();

vi.mock("@/lib/jwt", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/mcp", { headers });
}

describe("validateBearerToken", () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
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

  it("returns identity for a valid registered-user token", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-123",
      email: "test@test.com",
      isAdmin: true,
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer valid.jwt.token" }),
    );
    expect(result).toEqual({
      userId: "user-123",
      email: "test@test.com",
      isAdmin: true,
    });
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

  it("handles missing email and isAdmin gracefully", async () => {
    mockVerifyToken.mockResolvedValue({
      userId: "user-789",
    });
    const result = await validateBearerToken(
      makeRequest({ authorization: "Bearer minimal.jwt.token" }),
    );
    expect(result).toEqual({
      userId: "user-789",
      email: undefined,
      isAdmin: false,
    });
  });
});
