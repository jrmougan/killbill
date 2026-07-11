import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// Resolved lazily so a missing secret fails loudly at sign/verify time
// (not at module import / build time) — never fall back to a hardcoded value.
function getKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not set. Refusing to sign/verify session tokens without a configured secret.');
    }
    return new TextEncoder().encode(secret);
}

export async function signToken(payload: JWTPayload) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d') // 7 days session
        .sign(getKey());
}

// Guest session lifetime: a shorter 72h window (vs 7d for registered users),
// refreshed on activity with a sliding re-sign (see refreshGuestToken) but never
// past the space's own expiry (the `hardCap` claim baked in at mint time).
export const GUEST_SESSION_SECONDS = 72 * 60 * 60;

/**
 * Claims carried by a guest (shadow-user) session JWT. `groupId` cages the guest
 * to a single EPHEMERAL space; `role` is a hint only (authz always re-checks the
 * Membership row in DB). `hardCap` is the epoch-seconds ceiling (the space's
 * `expiresAt`) beyond which the session may never be extended — embedded so the
 * sliding renewal in the edge middleware needs no DB lookup.
 */
export type GuestClaims = {
    userId: string;
    kind: 'guest';
    groupId: string;
    role: string;
    /** Epoch seconds; the space's expiresAt. Absent when the space has no expiry. */
    hardCap?: number;
};

/** Compute the guest session exp (epoch seconds): now+72h, clamped to hardCap. */
function guestExp(now: number, hardCap?: number): number {
    const target = now + GUEST_SESSION_SECONDS;
    return hardCap != null && hardCap < target ? hardCap : target;
}

/**
 * Sign a fresh guest session token. `hardCapAt` is the space's `expiresAt` (or
 * null): it becomes a persisted claim so no request can extend the session past
 * the trip's own end. Returns the signed JWT.
 */
export async function signGuestToken(
    claims: Omit<GuestClaims, 'kind' | 'hardCap'>,
    hardCapAt?: Date | null,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const hardCap = hardCapAt ? Math.floor(hardCapAt.getTime() / 1000) : undefined;
    const payload: GuestClaims = { ...claims, kind: 'guest', ...(hardCap != null ? { hardCap } : {}) };
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(guestExp(now, hardCap))
        .sign(getKey());
}

/**
 * Sliding renewal for a guest session: re-issue a token with a fresh 72h window
 * (clamped to the original `hardCap`) from an already-verified guest payload.
 * Returns null when the payload is not a guest session or the hard cap has
 * already passed (nothing left to extend — let the current token lapse).
 * Edge-safe: derives everything from the JWT, no DB access.
 */
export async function refreshGuestToken(payload: JWTPayload): Promise<string | null> {
    if (payload.kind !== 'guest') return null;
    if (typeof payload.userId !== 'string' || typeof payload.groupId !== 'string') return null;
    const hardCap = typeof payload.hardCap === 'number' ? payload.hardCap : undefined;
    const now = Math.floor(Date.now() / 1000);
    if (hardCap != null && now >= hardCap) return null;
    return await signGuestToken(
        {
            userId: payload.userId,
            groupId: payload.groupId,
            role: typeof payload.role === 'string' ? payload.role : 'GUEST',
        },
        hardCap != null ? new Date(hardCap * 1000) : null,
    );
}

/**
 * Sign an MCP access token — a longer-lived JWT (default 90 days) carrying
 * `kind: 'mcp'` so it can be distinguished from browser session tokens.
 * Issued by POST /api/me/mcp-token for use as a Bearer credential by external
 * agent clients (e.g. Hermes Agent).
 */
export async function signMcpToken(payload: JWTPayload, ttlDays = 90): Promise<string> {
    return await new SignJWT({ ...payload, kind: 'mcp' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${ttlDays}d`)
        .sign(getKey());
}

export async function verifyToken(token: string) {
    try {
        const { payload } = await jwtVerify(token, getKey(), {
            algorithms: ['HS256'],
        });
        return payload;
    } catch (_error) {
        return null;
    }
}
