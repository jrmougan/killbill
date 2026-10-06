import type { NextResponse } from "next/server";
import { getSessionCtx, type SessionCtx, type SpaceAccessOk } from "./authz";
import { HttpError, requireSpace, toErrorResponse } from "./http";
import { SpaceStatus } from "@/generated/prisma/enums";

/** 500 body + console.error label shared by every list route (route() `errorMessage` / `logLabel`). */
export const LIST_ERROR_MESSAGE = "Error en las listas";
export const LIST_ERROR_LOG_LABEL = "Shopping list error:";

/**
 * Map a thrown error of a list route to its JSON response: ListError (and any
 * HttpError / ZodError) → `{ error, code? }` with its status; anything else →
 * 500 "Error en las listas". Thin alias of the toolkit's toErrorResponse, kept
 * for the routes not yet migrated to route().
 */
export function listErrorResponse(e: unknown): NextResponse {
    return toErrorResponse(e, { fallbackMessage: LIST_ERROR_MESSAGE, logLabel: LIST_ERROR_LOG_LABEL });
}

export const LIST_ARCHIVED_MESSAGE = "Este espacio está archivado: sus listas son de solo lectura";

/**
 * Space-list write gate (throwing, for route() handlers). A list is a PLANNING
 * tool (it never creates an expense), so it stays editable while the space is
 * SETTLING — people still shop while the debts are being closed. Only ARCHIVED
 * (read-only memory) blocks list writes: 409 SPACE_NOT_WRITABLE.
 * Membership/guest rules are the usual requireSpaceAccess ones (guests denied).
 */
export async function requireListWrite(ctx: SessionCtx | null, groupId: string): Promise<SpaceAccessOk> {
    const auth = await requireSpace(ctx, groupId, { allowArchived: true });
    if (auth.space.status === SpaceStatus.ARCHIVED) {
        throw new HttpError(409, LIST_ARCHIVED_MESSAGE, "SPACE_NOT_WRITABLE");
    }
    return auth;
}

/** Non-throwing variant of requireListWrite (reads the session itself). */
export async function requireListWriteAccess(
    groupId: string,
): Promise<{ ok: true; auth: SpaceAccessOk } | { ok: false; response: NextResponse }> {
    try {
        return { ok: true, auth: await requireListWrite(await getSessionCtx(), groupId) };
    } catch (e) {
        if (e instanceof HttpError) return { ok: false, response: toErrorResponse(e) };
        throw e;
    }
}
