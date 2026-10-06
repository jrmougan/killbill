import { getActiveGroup } from "./membership";
import { requireSpaceAccess, type SessionCtx, type SpaceAccessOk } from "./authz";
import { SpaceType } from "@/generated/prisma/enums";

/**
 * Which space the /settle screens show: the explicit `?space=<groupId>` (e.g.
 * "Ir a liquidar deudas" from a space's close page) when present, else the
 * active-group cookie. Always authorized against that space via
 * requireSpaceAccess (DB membership; guests caged to their space). Returns null
 * when there is nothing to settle there (no space, no access, personal mode).
 */
export async function resolveSettleSpace(
    ctx: SessionCtx,
    spaceParam: string | string[] | undefined,
): Promise<{ groupId: string; auth: SpaceAccessOk; explicit: boolean } | null> {
    const requested = typeof spaceParam === "string" && spaceParam ? spaceParam : null;
    const groupId = requested ?? (await getActiveGroup(ctx.userId));
    if (!groupId) return null;
    const auth = await requireSpaceAccess(ctx, groupId, { allowArchived: true, allowGuest: true });
    if (!auth.ok || auth.space.type === SpaceType.INDIVIDUAL) return null;
    return { groupId, auth, explicit: requested !== null };
}
