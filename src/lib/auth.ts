import { cookies } from 'next/headers';
import { verifyToken } from './jwt';
import { isTokenVersionCurrent } from './token-version';

export * from './jwt';

/**
 * Read and verify the `session_token` cookie.
 *
 * Registered (and MCP-forwarded) sessions are additionally checked against the
 * DB `User.tokenVersion` (one cached PK lookup), so a revoked token — "cerrar
 * sesión en todos los dispositivos" — or a deleted user is rejected on its very
 * next request. Guest sessions skip this: getSessionCtx revalidates them against
 * their Membership row instead.
 *
 * Route handlers should prefer `getSessionCtx` (authz.ts), which builds on this.
 *
 * Sessions are NOT slid on activity: a registered session lasts 7 days from
 * login (only guest sessions slide, in the proxy — see refreshGuestToken).
 */
export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;
    if (!token) return null;
    const payload = await verifyToken(token);
    if (!payload) return null;
    if (payload.kind === 'guest') return payload;
    if (!(await isTokenVersionCurrent(payload))) return null;
    return payload;
}
