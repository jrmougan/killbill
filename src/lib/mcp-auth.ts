import { resolveAccessToken } from "@/lib/access-tokens";

/**
 * MCP Bearer-token authentication.
 *
 * Extracts an opaque access token (`kb_…`) from the `Authorization: Bearer …`
 * header and resolves it against the AccessToken table (sha256 lookup): it must
 * exist, not be revoked or expired, and belong to a registered (non-guest)
 * user. A JWT of any kind (browser session, guest or a legacy 90-day MCP JWT)
 * is NOT an accepted Bearer → null (401).
 */

export type McpIdentity = {
  userId: string;
  email?: string;
  isAdmin?: boolean;
};

export type McpBearerIdentity = McpIdentity & {
  /** AccessToken row id the caller authenticated with. */
  tokenId: string;
  /** User.tokenVersion now, baked into the internal per-request JWT. */
  tokenVersion: number;
};

export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

export async function validateBearerToken(request: Request): Promise<McpBearerIdentity | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  const resolved = await resolveAccessToken(token);
  if (!resolved) return null;

  return {
    userId: resolved.userId,
    email: resolved.email ?? undefined,
    isAdmin: resolved.isAdmin,
    tokenId: resolved.tokenId,
    tokenVersion: resolved.tokenVersion,
  };
}
