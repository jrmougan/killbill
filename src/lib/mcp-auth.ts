import { verifyToken } from "@/lib/jwt";
import { isTokenVersionCurrent } from "@/lib/token-version";

/**
 * MCP Bearer-token authentication.
 *
 * Extracts a JWT from the `Authorization: Bearer …` header and validates it
 * using the same `JWT_SECRET` and `verifyToken` used for browser sessions.
 * Only dedicated MCP tokens are accepted; browser and guest tokens are rejected.
 * The token's `tv` claim must still equal User.tokenVersion (one PK lookup), so
 * "cerrar sesión en todos los dispositivos" also revokes every MCP token, and a
 * deleted user's tokens stop working. Tokens without `tv` count as tv=0.
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
  if (!(await isTokenVersionCurrent(payload))) return null;

  return {
    userId: payload.userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAdmin: payload.isAdmin === true,
  };
}
