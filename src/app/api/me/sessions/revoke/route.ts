import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { bumpTokenVersion } from "@/lib/token-version";
import { forbidden, route } from "@/lib/http";

/**
 * POST /api/me/sessions/revoke — "Cerrar sesión en todos los dispositivos".
 *
 * Bumps User.tokenVersion, which invalidates EVERY session cookie and MCP token
 * issued to the caller so far (each carries the old `tv`). The current device is
 * logged out too (its cookie is cleared); the client then goes to /login.
 * Browser sessions only: guests have their own revocation (membership) and an
 * MCP token must not be able to act on the account's sessions.
 */
export const POST = route(
    {
        auth: "user-or-guest",
        errorMessage: "No se pudieron cerrar las sesiones. Inténtalo de nuevo.",
        logLabel: "Error al revocar sesiones:",
    },
    async ({ ctx }) => {
        // Guests AND MCP tokens: same historical 403 (route 'user' would let MCP through).
        if (ctx.kind !== undefined) throw forbidden("Acción no permitida con este tipo de sesión");

        // A failure here is a 500 and the current cookie is kept.
        await bumpTokenVersion(ctx.userId);

        const cookieStore = await cookies();
        cookieStore.delete("session_token");
        cookieStore.delete("user_id");
        return NextResponse.json({ success: true });
    },
);
