import { NextResponse } from "next/server";
import { getGroupBalances } from "@/lib/ledger-read";
import {
    assertCanArchive,
    assertNotArchived,
    assertStatusTransition,
    assertTypeUpgrade,
    normalizeSpaceName,
    settleUrlFor,
    SpacePolicyError,
} from "@/lib/space-policy";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { withSpaceLock } from "@/lib/expense-tx";
import { badRequest, HttpError, parseJson, requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";
import { PatchSpaceBody, SPACE_BODY_OPTIONS } from "@/lib/space-schemas";

/**
 * Space management (OWNER/ADMIN only): lifecycle transitions
 * (ACTIVE<->SETTLING, ->ARCHIVED), the single "Convertir en grupo"
 * (COUPLE->GROUP) upgrade and renaming.
 *
 * Body (any combination):
 *   { status: "SETTLING" | "ACTIVE" | "ARCHIVED" }   // lifecycle transition
 *   { type: "GROUP" }                                 // upgrade (COUPLE->GROUP)
 *   { name: "..." }                                   // rename (1–60 chars)
 *
 * Rules:
 * - ARCHIVED is terminal and read-only: no transition, no upgrade, no rename
 *   (409 SPACE_NOT_WRITABLE / 400 INVALID_TRANSITION).
 * - Archiving requires closed accounts: no PENDING settlement (409
 *   PENDING_SETTLEMENTS) and every ACTIVE member at peace (409 OPEN_BALANCES).
 *   Both carry `settleUrl` so the UI can link straight to /settle?space=<id>.
 */
export const PATCH = route(
    { auth: "user", params: idParams, unauthorizedMessage: "Unauthorized" },
    async ({ req, ctx, params: { id } }) => {
        // allowArchived: true so we can operate on SETTLING/ARCHIVED spaces (e.g.
        // reopen a SETTLING space). The policy rules below do the real gating.
        await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });

        // Parsed after the role gate: status/type must be enum values (400 "Estado
        // no válido" / "Tipo no válido"); the name is checked by normalizeSpaceName.
        const body = await parseJson(req, PatchSpaceBody, SPACE_BODY_OPTIONS);

        // The status/type the rules check are re-read UNDER the space row lock, and
        // the archive guard (balances + PENDING settlements) runs in that same
        // transaction as the update (A3): a settlement or expense of this space can't
        // land between "accounts are closed" and ARCHIVED, nor two transitions race.
        try {
            const space = await withSpaceLock(id, async (tx, lockedStatus) => {
                const current = await tx.couple.findUniqueOrThrow({ where: { id }, select: { type: true } });
                const currentStatus = lockedStatus;
                const data: { status?: SpaceStatus; type?: SpaceType; name?: string; archivedAt?: Date | null } = {};

                // Lifecycle transition.
                if (body.status !== undefined) {
                    const toStatus = body.status;
                    assertStatusTransition(currentStatus, toStatus);
                    if (toStatus === SpaceStatus.ARCHIVED) {
                        const [balances, pendingSettlements] = await Promise.all([
                            getGroupBalances(id, tx),
                            tx.settlement.count({ where: { coupleId: id, status: "PENDING" } }),
                        ]);
                        assertCanArchive({ balances, pendingSettlements });
                    }
                    data.status = toStatus;
                    // Stamp archivedAt on archive; clear it when reopening to ACTIVE.
                    if (toStatus === SpaceStatus.ARCHIVED) data.archivedAt = new Date();
                    else if (toStatus === SpaceStatus.ACTIVE) data.archivedAt = null;
                }

                // Type upgrade (COUPLE -> GROUP only, never on an archived space).
                if (body.type !== undefined) {
                    assertNotArchived(currentStatus);
                    assertTypeUpgrade(current.type as SpaceType, body.type);
                    data.type = body.type;
                }

                // Rename (never on an archived space).
                if (body.name !== undefined) {
                    assertNotArchived(currentStatus);
                    data.name = normalizeSpaceName(body.name);
                }

                if (Object.keys(data).length === 0) throw badRequest("Nada que actualizar");

                return tx.couple.update({
                    where: { id },
                    data,
                    select: { id: true, name: true, type: true, status: true, archivedAt: true, expiresAt: true },
                });
            });
            return NextResponse.json({ success: true, space });
        } catch (e) {
            // Archive blockers carry the settle link so the UI can jump to /settle?space=<id>.
            if (e instanceof SpacePolicyError && (e.code === "OPEN_BALANCES" || e.code === "PENDING_SETTLEMENTS")) {
                throw new HttpError(e.status, e.message, e.code, { settleUrl: settleUrlFor(id) });
            }
            throw e;
        }
    },
);
