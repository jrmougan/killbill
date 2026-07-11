import { verifyToken } from "@/lib/jwt";

/**
 * MCP Bearer-token authentication.
 *
 * Extracts a JWT from the `Authorization: Bearer …` header and validates it
 * using the same `JWT_SECRET` and `verifyToken` used for browser sessions.
 * Guest tokens are rejected — guests are too restricted for programmatic access.
 */

export type McpIdentity = {
  userId: string;
  email?: string;
  isAdmin?: boolean;
};

export async function validateBearerToken(request: Request): Promise<McpIdentity | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload?.userId || typeof payload.userId !== "string") return null;

  // Guest tokens are rejected for MCP — they're short-lived and restricted.
  if (payload.kind === "guest") return null;

  return {
    userId: payload.userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAdmin: payload.isAdmin === true,
  };
}
