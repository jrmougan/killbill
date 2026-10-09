/**
 * Zod schemas of the access-token API (/api/me/tokens). Shape only: the
 * active-token cap (409 TOKEN_LIMIT) is enforced by access-tokens.ts.
 */
import { z } from "zod";
import { jsonObject } from "@/lib/http/schemas";
import type { AccessTokenDuration } from "@/lib/access-tokens";

// Mirrors ACCESS_TOKEN_NAME_MAX (access-tokens.ts) and the VarChar(60) column; not imported
// at runtime so this schema stays free of the DB client.
const NAME_MAX = 60;

const NAME_REQUIRED = "El nombre es obligatorio";
const NAME_TOO_LONG = "El nombre es demasiado largo";
const INVALID_DURATION = "Duración no válida";

/**
 * POST: `{ name, expiresInDays }`. `expiresInDays` is REQUIRED and must be one
 * of the offered durations or an explicit `null` ("sin caducidad"): a missing
 * value is a 400, never silently a default or a non-expiring token.
 */
export const AccessTokenCreateBody = jsonObject({
    name: z.string({ error: NAME_REQUIRED }).trim().min(1, NAME_REQUIRED).max(NAME_MAX, NAME_TOO_LONG),
    expiresInDays: z.union([z.literal([30, 90, 365], { error: INVALID_DURATION }), z.null()], {
        error: INVALID_DURATION,
    }),
});
export type AccessTokenCreateBody = z.output<typeof AccessTokenCreateBody>;

// Compile-time guard: the accepted durations stay in sync with access-tokens.ts.
type _DurationsMatch = [AccessTokenCreateBody["expiresInDays"]] extends [AccessTokenDuration]
    ? [AccessTokenDuration] extends [AccessTokenCreateBody["expiresInDays"]]
        ? true
        : never
    : never;
const _durationsMatch: _DurationsMatch = true;
void _durationsMatch;
