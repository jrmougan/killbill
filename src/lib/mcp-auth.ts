import { ACCESS_TOKEN_PREFIX, resolveAccessToken } from "@/lib/access-tokens";
import { verifyToken } from "@/lib/jwt";
import { isTokenVersionCurrent } from "@/lib/token-version";

/**
 * MCP Bearer-token authentication. Two credentials are accepted, told apart by
 * their format:
 *
 * - `kb_…` — an opaque access token (access-tokens.ts), resolved against the
 *   AccessToken table (sha256 lookup): it must exist, not be revoked or expired,
 *   and belong to a registered (non-guest) user.
 * - anything else — the legacy 90-day JWT that POST /api/me/mcp-token issued
 *   until issue #60 (it now creates a `kb_…` token; retirement: #61), validated
 *   with the same `JWT_SECRET` and `verifyToken` used for browser sessions. Only
 *   `kind: 'mcp'` is accepted; browser and guest tokens are rejected. Its `tv`
 *   claim must still equal User.tokenVersion (one PK lookup), and a deleted
 *   user's tokens stop working. Tokens without `tv` count as tv=0.
 *
 * "Cerrar sesión en todos los dispositivos" revokes both: the JWT through `tv`,
 * the opaque tokens by row (see bumpTokenVersion).
 */

export type McpIdentity = {
  userId: string;
  email?: string;
  isAdmin?: boolean;
};

export type McpBearerIdentity =
  | (McpIdentity & { credential: "jwt" })
  | (McpIdentity & {
      credential: "access-token";
      /** AccessToken row id the caller authenticated with. */
      tokenId: string;
      /** User.tokenVersion now, baked into the internal per-request JWT. */
      tokenVersion: number;
    });

export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

export async function validateBearerToken(request: Request): Promise<McpBearerIdentity | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  // A compact JWT always starts with `eyJ` (base64url of `{"`), never `kb_`, so
  // the prefix alone picks the branch; a malformed `kb_…` is a 401, not a JWT try.
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const resolved = await resolveAccessToken(token);
    if (!resolved) return null;
    return {
      credential: "access-token",
      userId: resolved.userId,
      email: resolved.email ?? undefined,
      isAdmin: resolved.isAdmin,
      tokenId: resolved.tokenId,
      tokenVersion: resolved.tokenVersion,
    };
  }

  const payload = await verifyToken(token);
  if (!payload?.userId || typeof payload.userId !== "string") return null;

  if (payload.kind !== "mcp") return null;
  // The internal per-request JWT (signInternalMcpToken, carries `tid`) is a
  // cookie for the internal client only, never a Bearer credential.
  if (payload.tid !== undefined) return null;
  if (!(await isTokenVersionCurrent(payload))) return null;

  return {
    credential: "jwt",
    userId: payload.userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAdmin: payload.isAdmin === true,
  };
}
