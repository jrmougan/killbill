import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
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
import { SettlementError } from "@/lib/settlement-rules";

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
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    // allowArchived: true so we can operate on SETTLING/ARCHIVED spaces (e.g.
    // reopen a SETTLING space). The policy rules below do the real gating.
    const auth = await requireSpaceAccess(ctx, id, {
        roles: ["OWNER", "ADMIN"],
        allowArchived: true,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    let body: { status?: unknown; type?: unknown; name?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    // The status/type the rules check are re-read UNDER the space row lock, and
    // the archive guard (balances + PENDING settlements) runs in that same
    // transaction as the update (A3): a settlement or expense of this space can't
    // land between "accounts are closed" and ARCHIVED, nor two transitions race.
    let result: { space: unknown } | NextResponse;
    try {
        result = await withSpaceLock(id, async (tx, lockedStatus) => {
            const current = await tx.couple.findUniqueOrThrow({ where: { id }, select: { type: true } });
            const currentStatus = lockedStatus;
            const data: { status?: SpaceStatus; type?: SpaceType; name?: string; archivedAt?: Date | null } = {};

            // Lifecycle transition.
            if (body.status !== undefined) {
                const to = body.status;
                if (typeof to !== "string" || !(to in SpaceStatus)) {
                    return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
                }
                const toStatus = to as SpaceStatus;
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
                const to = body.type;
                if (typeof to !== "string" || !(to in SpaceType)) {
                    return NextResponse.json({ error: "Tipo no válido" }, { status: 400 });
                }
                assertNotArchived(currentStatus);
                assertTypeUpgrade(current.type as SpaceType, to as SpaceType);
                data.type = to as SpaceType;
            }

            // Rename (never on an archived space).
            if (body.name !== undefined) {
                assertNotArchived(currentStatus);
                data.name = normalizeSpaceName(body.name);
            }

            if (Object.keys(data).length === 0) {
                return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
            }

            const space = await tx.couple.update({
                where: { id },
                data,
                select: { id: true, name: true, type: true, status: true, archivedAt: true, expiresAt: true },
            });
            return { space };
        });
    } catch (e) {
        if (e instanceof SpacePolicyError) {
            const settleUrl =
                e.code === "OPEN_BALANCES" || e.code === "PENDING_SETTLEMENTS" ? settleUrlFor(id) : undefined;
            return NextResponse.json({ error: e.message, code: e.code, settleUrl }, { status: e.status });
        }
        if (e instanceof SettlementError) return NextResponse.json(e.toJSON(), { status: e.status });
        throw e;
    }
    if (result instanceof NextResponse) return result;

    return NextResponse.json({ success: true, space: result.space });
}
