import { NextResponse } from "next/server";
import { createAccessToken, listAccessTokens } from "@/lib/access-tokens";
import { AccessTokenCreateBody } from "@/lib/access-token-schemas";
import { enforceRateLimit, forbidden, parseJson, route } from "@/lib/http";

/**
 * Personal access tokens for MCP clients (`Authorization: Bearer kb_…` on
 * POST /api/mcp). Opaque, stored only as a sha256 hash, revocable, with an
 * optional expiry. The plaintext is returned ONCE by POST.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

const BROWSER_ONLY = "Acción no permitida con este tipo de sesión";

// 'user-or-guest' + an explicit `ctx.kind` check in every handler: guests AND
// MCP sessions get the same 403. Only a regular browser session manages tokens —
// a token must never be able to mint, list or extend tokens itself.

export const GET = route(
    { auth: "user-or-guest", errorMessage: "No se pudieron cargar los tokens", logLabel: "Error al listar tokens de acceso:" },
    async ({ ctx }) => {
        if (ctx.kind !== undefined) throw forbidden(BROWSER_ONLY);
        const tokens = await listAccessTokens(ctx.userId);
        return NextResponse.json({ tokens }, { headers: NO_STORE });
    },
);

export const POST = route(
    { auth: "user-or-guest", errorMessage: "No se pudo generar el token", logLabel: "Error al generar el token de acceso:" },
    async ({ req, ctx }) => {
        if (ctx.kind !== undefined) throw forbidden(BROWSER_ONLY);
        enforceRateLimit(`access-token:${ctx.userId}`, CREATE_LIMIT, CREATE_WINDOW_MS);
        // Parsed after the session-kind gate so a guest/MCP caller always gets 403.
        const body = await parseJson(req, AccessTokenCreateBody);

        // AccessTokenError (409 TOKEN_LIMIT) is mapped by toErrorResponse.
        const { token, summary } = await createAccessToken(ctx.userId, {
            name: body.name,
            expiresInDays: body.expiresInDays,
        });

        return NextResponse.json({ token, ...summary }, { status: 201, headers: NO_STORE });
    },
);
