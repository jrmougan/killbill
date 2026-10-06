import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getGroupBalances } from "@/lib/ledger-read";
import { kickBlocker, leaveBlocker, settleUrlFor, type LeaveBlock } from "@/lib/space-policy";
import { withSpaceLock } from "@/lib/expense-tx";
import { MembershipRole, MembershipStatus } from "@/generated/prisma/enums";
import { conflict, forbidden, HttpError, notFound, requireSpace, route } from "@/lib/http";
import { memberParams, MemberRoleBody, parseSpaceBody } from "@/lib/space-schemas";

const NOT_IN_SPACE = "Ese miembro no está en el espacio";

/**
 * A leave/kick blocker as a thrown error. The body keeps the blocker's own
 * fields (incl. its `status` and `balanceCents`) plus `settleUrl` for HAS_BALANCE,
 * exactly as before the route() migration.
 */
function blockError(block: LeaveBlock, groupId: string): HttpError {
    const { error, code, ...rest } = block;
    const extra = code === "HAS_BALANCE" ? { ...rest, settleUrl: settleUrlFor(groupId) } : rest;
    return new HttpError(block.status, error, code, extra);
}

/**
 * Remove a member from a space (Fase 1). NEVER a physical delete — a self-leave
 * becomes LEFT, an expulsion by OWNER/ADMIN becomes REMOVED. Preserving the row
 * keeps the accounting intact (Split/Settlement/Ledger hang off User.id).
 *
 * - Self-leave: any ACTIVE member may leave (status -> LEFT), except:
 *     409 { code: "LAST_OWNER" } — the caller is the only OWNER and other
 *         members remain (not overridable);
 *     409 { code: "HAS_BALANCE", balanceCents, settleUrl } — the caller's net
 *         balance in this space is open (beyond ±1 cent); repeat with `?force=1`
 *         once the user explicitly confirmed leaving anyway.
 * - Expulsion: OWNER/ADMIN may remove another member (status -> REMOVED), only
 *   once that member's balance is closed: 409 { code: "HAS_BALANCE",
 *   balanceCents, settleUrl } otherwise (no `force` — the debt must be settled).
 * - An ADMIN cannot remove an OWNER (only an OWNER can).
 */
export const DELETE = route(
    { auth: "user", params: memberParams, unauthorizedMessage: "Unauthorized" },
    async ({ req, ctx, params: { id, userId: targetUserId } }) => {
        // allowArchived:true so a member can still leave a SETTLING/ARCHIVED space.
        const auth = await requireSpace(ctx, id, { allowArchived: true });

        const isSelf = targetUserId === auth.userId;
        const searchParams = new URL(req.url).searchParams;
        const force = searchParams.get("force") === "1" || searchParams.get("force") === "true";

        // RGPD suppression (Fase 3): an OWNER/ADMIN may anonymize a GUEST shadow user
        // on expulsion (`?anonymize=true`). We NEVER physically delete a user with
        // accounting attached (that would break the ledger's zero-sum); instead we
        // scrub the display name to "Invitado" while every Split/Settlement/Ledger row
        // stays intact. Only applies to shadow guests, never a real account.
        const anonymize = !isSelf && searchParams.get("anonymize") === "true";

        // Every check that guards the status change (target/caller membership, the
        // roster, the target's balance) is read UNDER the space row lock, in the same
        // transaction as the write (A3): an expense, settlement or role change of
        // this space can't slip in between the balance check and the REMOVED/LEFT.
        // A thrown denial rolls the (still write-free) transaction back.
        const newStatus = await withSpaceLock(id, async (tx) => {
            const [target, caller] = await Promise.all([
                tx.membership.findUnique({ where: { groupId_userId: { groupId: id, userId: targetUserId } } }),
                tx.membership.findUnique({ where: { groupId_userId: { groupId: id, userId: auth.userId } } }),
            ]);
            if (!target || target.status !== MembershipStatus.ACTIVE) throw notFound(NOT_IN_SPACE);
            if (!caller || caller.status !== MembershipStatus.ACTIVE) throw forbidden("No perteneces a este espacio");

            let status: MembershipStatus;
            if (isSelf) {
                const [roster, balances] = await Promise.all([
                    tx.membership.findMany({
                        where: { groupId: id, status: MembershipStatus.ACTIVE },
                        select: { userId: true, role: true },
                    }),
                    getGroupBalances(id, tx),
                ]);
                const block = leaveBlocker({
                    role: target.role,
                    ownerCount: roster.filter((m) => m.role === MembershipRole.OWNER).length,
                    activeCount: roster.length,
                    balanceCents: balances[targetUserId] ?? 0,
                    force,
                });
                if (block) throw blockError(block, id);
                status = MembershipStatus.LEFT;
            } else {
                // Expelling another member requires OWNER/ADMIN (role re-read under the lock).
                if (caller.role !== MembershipRole.OWNER && caller.role !== MembershipRole.ADMIN) {
                    throw forbidden("No tienes permisos para expulsar miembros");
                }
                // Only an OWNER can remove another OWNER.
                if (target.role === MembershipRole.OWNER && caller.role !== MembershipRole.OWNER) {
                    throw forbidden("Solo un propietario puede quitar a otro propietario");
                }
                // A2: never expel someone with an open balance (no force override).
                const balances = await getGroupBalances(id, tx);
                const block = kickBlocker(balances[targetUserId] ?? 0);
                if (block) throw blockError(block, id);
                status = MembershipStatus.REMOVED;
            }

            await tx.membership.update({
                where: { groupId_userId: { groupId: id, userId: targetUserId } },
                data: { status, leftAt: new Date() },
            });
            if (anonymize) {
                await tx.user.updateMany({
                    where: { id: targetUserId, isGuest: true },
                    data: { name: "Invitado" },
                });
            }
            return status;
        });

        return NextResponse.json({ success: true, status: newStatus, anonymized: anonymize });
    },
);

/**
 * Change a member's role. Body `{ role: "OWNER" | "ADMIN" | "MEMBER" }`.
 * OWNER only. Guests keep their GUEST role (403). The space can never be left
 * without an OWNER (409 LAST_OWNER when demoting the only one). This is how an
 * owner hands the space over before leaving (see LAST_OWNER in DELETE).
 */
export const PATCH = route(
    { auth: "user", params: memberParams, unauthorizedMessage: "Unauthorized" },
    async ({ req, ctx, params: { id, userId: targetUserId } }) => {
        await requireSpace(ctx, id, { roles: [MembershipRole.OWNER], allowArchived: true });

        // Parsed after the OWNER gate: `role` must be OWNER | ADMIN | MEMBER (400 "Rol no válido").
        const { role } = await parseSpaceBody(req, MemberRoleBody);

        const target = await prisma.membership.findUnique({
            where: { groupId_userId: { groupId: id, userId: targetUserId } },
            include: { user: { select: { isGuest: true } } },
        });
        if (!target || target.status !== MembershipStatus.ACTIVE) throw notFound(NOT_IN_SPACE);
        if (target.role === MembershipRole.GUEST || target.user.isGuest) {
            throw forbidden("Un invitado no puede cambiar de rol");
        }
        if (target.role === role) {
            return NextResponse.json({ success: true, role });
        }

        if (target.role === MembershipRole.OWNER) {
            const owners = await prisma.membership.count({
                where: { groupId: id, status: MembershipStatus.ACTIVE, role: MembershipRole.OWNER },
            });
            if (owners <= 1) throw conflict("El espacio necesita al menos una persona propietaria.", "LAST_OWNER");
        }

        await prisma.membership.update({
            where: { groupId_userId: { groupId: id, userId: targetUserId } },
            data: { role },
        });
        return NextResponse.json({ success: true, role });
    },
);
