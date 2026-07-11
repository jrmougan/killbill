import { verifyToken } from "@/lib/jwt";

/**
 * MCP Bearer-token authentication.
 *
 * Extracts a JWT from the `Authorization: Bearer …` header and validates it
 * using the same `JWT_SECRET` and `verifyToken` used for browser sessions.
 * Only dedicated MCP tokens are accepted; browser and guest tokens are rejected.
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

  if (payload.kind !== "mcp") return null;

  return {
    userId: payload.userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAdmin: payload.isAdmin === true,
  };
}
