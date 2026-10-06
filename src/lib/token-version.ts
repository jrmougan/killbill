import { cache } from "react";
import type { JWTPayload } from "jose";
import { prisma } from "./db";
import { tokenVersionOf } from "./jwt";

/**
 * Token revocation without a blacklist (H2).
 *
 * Every registered-session and MCP JWT carries `tv` = User.tokenVersion at mint
 * time. A token is accepted only while that still equals the DB value, so
 * bumping the column ("cerrar sesión en todos los dispositivos", password
 * change) revokes every outstanding token of the user at once.
 *
 * Cost: one primary-key lookup selecting a single INT column. `cache` dedupes it
 * within one React server render (layout + page both read the session), and is
 * a plain pass-through in route handlers.
 */
const currentTokenVersion = cache(async (userId: string): Promise<number | null> => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
    });
    return user?.tokenVersion ?? null;
});

/**
 * Whether a verified JWT payload is still current for its user. A deleted user
 * or a stale/malformed `tv` → false. Tokens minted before the `tv` claim existed
 * count as tv=0 (see tokenVersionOf).
 */
export async function isTokenVersionCurrent(payload: JWTPayload): Promise<boolean> {
    if (typeof payload.userId !== "string" || !payload.userId) return false;
    const current = await currentTokenVersion(payload.userId);
    return current !== null && current === tokenVersionOf(payload);
}

/**
 * Invalidate every session/MCP token of `userId` issued so far. Returns the new
 * version (to sign a fresh token for the current device, if desired).
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
    const user = await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
    });
    return user.tokenVersion;
}
