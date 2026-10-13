import { NextResponse } from "next/server";
import { revokeAccessToken } from "@/lib/access-tokens";
import { forbidden, notFound, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";

/**
 * Revoke one of the caller's access tokens. Idempotent: revoking an already
 * revoked token of your own is still 200; a missing or foreign id is 404 (never
 * reveals that someone else's token exists).
 */
export const DELETE = route(
    {
        auth: "user-or-guest",
        params: idParams,
        errorMessage: "No se pudo revocar el token",
        logLabel: "Error al revocar el token de acceso:",
    },
    async ({ ctx, params: { id } }) => {
        // Same gate as /api/me/tokens: only a regular browser session (403 for guest/MCP).
        if (ctx.kind !== undefined) throw forbidden("Acción no permitida con este tipo de sesión");

        const revoked = await revokeAccessToken(ctx.userId, id);
        if (!revoked) throw notFound("Token no encontrado");

        return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
    },
);
