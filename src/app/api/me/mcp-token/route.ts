import { NextResponse } from "next/server";
import { HERMES_TOKEN_DAYS, HERMES_TOKEN_NAME, replaceNamedAccessToken } from "@/lib/access-tokens";
import { enforceRateLimit, forbidden, route } from "@/lib/http";

/**
 * "Conectar Hermes Agent" (Ajustes → Conexiones): issue the Bearer credential
 * for Hermes Agent on POST /api/mcp.
 *
 * It creates an opaque access token (`kb_…`, access-tokens.ts) named
 * «Hermes Agent» that expires in 90 days, so it shows up in "Tokens de acceso"
 * and can be revoked on its own. Reconnecting revokes the caller's previous
 * active «Hermes Agent» token(s) once the new one exists (`replaced` = how
 * many), so reconnecting never piles up orphan tokens.
 *
 * Until issue #60 this route signed a 90-day `kind: 'mcp'` JWT; those JWTs are
 * still accepted as Bearer by mcp-auth.ts until they expire or the user closes
 * every session (their retirement is issue #61), but none is issued any more.
 *
 * Response (201, no-store): `{ token, expiresInDays, expiresAt, replaced,
 * ...AccessTokenSummary }` — `token`, `expiresInDays` and `expiresAt` keep the
 * historical shape.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
// Same budget (and key) as POST /api/me/tokens: both create access tokens.
const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

// 'user-or-guest' + the explicit kind check: guests AND MCP tokens get the same
// historical 403 message (route 'user' would let an MCP token through).
export const POST = route(
  { auth: "user-or-guest", errorMessage: "No se pudo generar el token", logLabel: "Error al generar el token MCP:" },
  async ({ ctx }) => {
    // Only a regular browser session may mint MCP tokens (not a guest, and not an
    // MCP token forwarded as cookie — a token must not be able to extend itself).
    if (ctx.kind !== undefined) throw forbidden("Acción no permitida con este tipo de sesión");
    enforceRateLimit(`access-token:${ctx.userId}`, CREATE_LIMIT, CREATE_WINDOW_MS);

    // AccessTokenError (409 TOKEN_LIMIT) is mapped by toErrorResponse.
    const { token, summary, replaced } = await replaceNamedAccessToken(ctx.userId, {
      name: HERMES_TOKEN_NAME,
      expiresInDays: HERMES_TOKEN_DAYS,
    });

    return NextResponse.json(
      { token, ...summary, expiresInDays: HERMES_TOKEN_DAYS, replaced },
      { status: 201, headers: NO_STORE },
    );
  },
);
