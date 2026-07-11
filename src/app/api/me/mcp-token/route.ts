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
const MAX_TTL_DAYS = 365;

function getMcpTokenTtlDays(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return DEFAULT_TTL_DAYS;

  const ttlDays = Number(value);
  return ttlDays > 0 && ttlDays <= MAX_TTL_DAYS ? ttlDays : DEFAULT_TTL_DAYS;
}

export async function POST() {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.kind !== undefined) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ttlDays = getMcpTokenTtlDays(process.env.MCP_TOKEN_TTL_DAYS);

  try {
    const token = await signMcpToken(
      {
        userId: session.userId,
        email: session.email,
        isAdmin: session.isAdmin,
      },
      ttlDays,
    );

    return NextResponse.json(
      {
        token,
        expiresInDays: ttlDays,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
      },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
