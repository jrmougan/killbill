import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { signMcpToken } from "@/lib/jwt";

/**
 * Issue a long-lived Bearer JWT for MCP clients (e.g. Hermes Agent).
 *
 * The caller must be authenticated via the normal browser session cookie.
 * The returned token carries `kind: 'mcp'` and a 90-day expiry (configurable
 * via MCP_TOKEN_TTL_DAYS). It is used as `Authorization: Bearer <token>` when
 * connecting to POST /api/mcp. It embeds the user's current tokenVersion, so
 * POST /api/me/sessions/revoke invalidates it together with every session.
 */

const DEFAULT_TTL_DAYS = 90;
const MAX_TTL_DAYS = 365;

function getMcpTokenTtlDays(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return DEFAULT_TTL_DAYS;

  const ttlDays = Number(value);
  return ttlDays > 0 && ttlDays <= MAX_TTL_DAYS ? ttlDays : DEFAULT_TTL_DAYS;
}

export async function POST() {
  const ctx = await getSessionCtx();
  if (!ctx) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Only a regular browser session may mint MCP tokens (not a guest, and not an
  // MCP token forwarded as cookie — a token must not be able to extend itself).
  if (ctx.kind !== undefined) {
    return NextResponse.json({ error: "Acción no permitida con este tipo de sesión" }, { status: 403 });
  }

  const ttlDays = getMcpTokenTtlDays(process.env.MCP_TOKEN_TTL_DAYS);

  try {
    // Fresh identity + tokenVersion from the DB (getSessionCtx already proved the
    // session's tv is current; reading it here keeps the claims authoritative).
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true, isAdmin: true, tokenVersion: true },
    });
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const token = await signMcpToken(
      {
        userId: ctx.userId,
        email: user.email,
        isAdmin: user.isAdmin,
        tv: user.tokenVersion,
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
    return NextResponse.json({ error: "No se pudo generar el token" }, { status: 500 });
  }
}
