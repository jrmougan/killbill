import { NextResponse } from "next/server";
import { ListError } from "./list-crud";
import { getSessionCtx, requireSpaceAccess, type SpaceAccessOk } from "./authz";
import { SpaceStatus } from "@/generated/prisma/enums";

/** Map a thrown ListError to a JSON response; anything else → 500. Shared by every list route. */
export function listErrorResponse(e: unknown) {
    if (e instanceof ListError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Shopping list error:", e);
    return NextResponse.json({ error: "Error en las listas" }, { status: 500 });
}

export const LIST_ARCHIVED_MESSAGE = "Este espacio está archivado: sus listas son de solo lectura";

/**
 * Space-list write gate. A list is a PLANNING tool (it never creates an expense),
 * so it stays editable while the space is SETTLING — people still shop while the
 * debts are being closed. Only ARCHIVED (read-only memory) blocks list writes.
 * Membership/guest rules are the usual requireSpaceAccess ones (guests denied).
 */
export async function requireListWriteAccess(
    groupId: string,
): Promise<{ ok: true; auth: SpaceAccessOk } | { ok: false; response: NextResponse }> {
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, groupId, { allowArchived: true });
    if (!auth.ok) {
        return { ok: false, response: NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status }) };
    }
    if (auth.space.status === SpaceStatus.ARCHIVED) {
        return {
            ok: false,
            response: NextResponse.json({ error: LIST_ARCHIVED_MESSAGE, code: "SPACE_NOT_WRITABLE" }, { status: 409 }),
        };
    }
    return { ok: true, auth };
}
