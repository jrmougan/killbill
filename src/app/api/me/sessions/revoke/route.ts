import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCtx } from "@/lib/authz";
import { bumpTokenVersion } from "@/lib/token-version";

/**
 * POST /api/me/sessions/revoke — "Cerrar sesión en todos los dispositivos".
 *
 * Bumps User.tokenVersion, which invalidates EVERY session cookie and MCP token
 * issued to the caller so far (each carries the old `tv`). The current device is
 * logged out too (its cookie is cleared); the client then goes to /login.
 * Browser sessions only: guests have their own revocation (membership) and an
 * MCP token must not be able to act on the account's sessions.
 */
export async function POST() {
    const ctx = await getSessionCtx();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (ctx.kind !== undefined) {
        return NextResponse.json({ error: "Acción no permitida con este tipo de sesión" }, { status: 403 });
    }

    try {
        await bumpTokenVersion(ctx.userId);
    } catch (error) {
        console.error("Error al revocar sesiones:", error);
        return NextResponse.json({ error: "No se pudieron cerrar las sesiones. Inténtalo de nuevo." }, { status: 500 });
    }

    const cookieStore = await cookies();
    cookieStore.delete("session_token");
    cookieStore.delete("user_id");
    return NextResponse.json({ success: true });
}
