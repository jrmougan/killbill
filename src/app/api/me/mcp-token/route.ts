import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { signMcpToken } from "@/lib/jwt";

/**
 * Issue a long-lived Bearer JWT for MCP clients (e.g. Hermes Agent).
 *
 * The caller must be authenticated via the normal browser session cookie.
 * The returned token carries `kind: 'mcp'` and a 90-day expiry (configurable
 * via MCP_TOKEN_TTL_DAYS). It is used as `Authorization: Bearer <token>` when
 * connecting to POST /api/mcp.
 */

const DEFAULT_TTL_DAYS = 90;

export async function POST() {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ttlDaysRaw = Number(process.env.MCP_TOKEN_TTL_DAYS);
  const ttlDays = Number.isFinite(ttlDaysRaw) && ttlDaysRaw > 0 ? ttlDaysRaw : DEFAULT_TTL_DAYS;

  const token = await signMcpToken(
    {
      userId: session.userId,
      email: session.email,
      isAdmin: session.isAdmin,
    },
    ttlDays,
  );

  return NextResponse.json({
    token,
    expiresInDays: ttlDays,
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
  });
}
