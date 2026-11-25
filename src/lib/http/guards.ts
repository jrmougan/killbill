/**
 * Throwing variants of the per-request guards, for use inside route() handlers.
 */
import { requireSpaceAccess, type RequireSpaceOptions, type SessionCtx, type SpaceAccessOk } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { HttpError } from "./errors";

/**
 * requireSpaceAccess that THROWS the denial (same status / Spanish message /
 * `code`, e.g. 409 SPACE_NOT_WRITABLE) instead of returning it.
 */
export async function requireSpace(
    ctx: SessionCtx | null,
    groupId: string,
    options: RequireSpaceOptions = {},
): Promise<SpaceAccessOk> {
    const access = await requireSpaceAccess(ctx, groupId, options);
    if (!access.ok) throw new HttpError(access.status, access.error, access.code);
    return access;
}

export const RATE_LIMIT_MESSAGE = "Demasiadas solicitudes. Inténtalo de nuevo más tarde.";

/** Fixed-window rate limit (lib/rate-limit) → 429 with `Retry-After` when exceeded. */
export function enforceRateLimit(key: string, limit: number, windowMs: number, message = RATE_LIMIT_MESSAGE): void {
    const result = rateLimit(key, limit, windowMs);
    if (!result.allowed) {
        throw new HttpError(429, message, undefined, {}, { "Retry-After": String(result.retryAfterSeconds) });
    }
}
