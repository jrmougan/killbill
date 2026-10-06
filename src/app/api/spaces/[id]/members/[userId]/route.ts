import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupBalances } from "@/lib/ledger-read";
import { kickBlocker, leaveBlocker, settleUrlFor } from "@/lib/space-policy";
import { withSpaceLock } from "@/lib/expense-tx";
import { SettlementError } from "@/lib/settlement-rules";
import { MembershipRole, MembershipStatus } from "@/generated/prisma/enums";

type Outcome = { status: number; body: Record<string, unknown> };

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
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; userId: string }> },
) {
    const { id, userId: targetUserId } = await params;
    const ctx = await getSessionCtx();

    // allowArchived:true so a member can still leave a SETTLING/ARCHIVED space.
    const auth = await requireSpaceAccess(ctx, id, { allowArchived: true });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const isSelf = targetUserId === auth.userId;
    const searchParams = new URL(request.url).searchParams;
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
    let outcome: Outcome;
    try {
        outcome = await withSpaceLock(id, async (tx) => {
            const [target, caller] = await Promise.all([
                tx.membership.findUnique({ where: { groupId_userId: { groupId: id, userId: targetUserId } } }),
                tx.membership.findUnique({ where: { groupId_userId: { groupId: id, userId: auth.userId } } }),
            ]);
            if (!target || target.status !== MembershipStatus.ACTIVE) {
                return { status: 404, body: { error: "Ese miembro no está en el espacio" } };
            }
            if (!caller || caller.status !== MembershipStatus.ACTIVE) {
                return { status: 403, body: { error: "No perteneces a este espacio" } };
            }

            let newStatus: MembershipStatus;
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
                if (block) {
                    return {
                        status: block.status,
                        body: block.code === "HAS_BALANCE" ? { ...block, settleUrl: settleUrlFor(id) } : block,
                    };
                }
                newStatus = MembershipStatus.LEFT;
            } else {
                // Expelling another member requires OWNER/ADMIN (role re-read under the lock).
                if (caller.role !== MembershipRole.OWNER && caller.role !== MembershipRole.ADMIN) {
                    return { status: 403, body: { error: "No tienes permisos para expulsar miembros" } };
                }
                // Only an OWNER can remove another OWNER.
                if (target.role === MembershipRole.OWNER && caller.role !== MembershipRole.OWNER) {
                    return { status: 403, body: { error: "Solo un propietario puede quitar a otro propietario" } };
                }
                // A2: never expel someone with an open balance (no force override).
                const balances = await getGroupBalances(id, tx);
                const block = kickBlocker(balances[targetUserId] ?? 0);
                if (block) return { status: block.status, body: { ...block, settleUrl: settleUrlFor(id) } };
                newStatus = MembershipStatus.REMOVED;
            }

            await tx.membership.update({
                where: { groupId_userId: { groupId: id, userId: targetUserId } },
                data: { status: newStatus, leftAt: new Date() },
            });
            if (anonymize) {
                await tx.user.updateMany({
                    where: { id: targetUserId, isGuest: true },
                    data: { name: "Invitado" },
                });
            }
            return { status: 200, body: { success: true, status: newStatus, anonymized: anonymize } };
        });
    } catch (e) {
        if (e instanceof SettlementError) return NextResponse.json(e.toJSON(), { status: e.status });
        throw e;
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
}

const ASSIGNABLE_ROLES: MembershipRole[] = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];

/**
 * Change a member's role. Body `{ role: "OWNER" | "ADMIN" | "MEMBER" }`.
 * OWNER only. Guests keep their GUEST role (403). The space can never be left
 * without an OWNER (409 LAST_OWNER when demoting the only one). This is how an
 * owner hands the space over before leaving (see LAST_OWNER in DELETE).
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; userId: string }> },
) {
    const { id, userId: targetUserId } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, { roles: [MembershipRole.OWNER], allowArchived: true });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    let body: { role?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    const role = body?.role;
    if (typeof role !== "string" || !ASSIGNABLE_ROLES.includes(role as MembershipRole)) {
        return NextResponse.json({ error: "Rol no válido" }, { status: 400 });
    }

    const target = await prisma.membership.findUnique({
        where: { groupId_userId: { groupId: id, userId: targetUserId } },
        include: { user: { select: { isGuest: true } } },
    });
    if (!target || target.status !== MembershipStatus.ACTIVE) {
        return NextResponse.json({ error: "Ese miembro no está en el espacio" }, { status: 404 });
    }
    if (target.role === MembershipRole.GUEST || target.user.isGuest) {
        return NextResponse.json({ error: "Un invitado no puede cambiar de rol" }, { status: 403 });
    }
    if (target.role === role) {
        return NextResponse.json({ success: true, role });
    }

    if (target.role === MembershipRole.OWNER) {
        const owners = await prisma.membership.count({
            where: { groupId: id, status: MembershipStatus.ACTIVE, role: MembershipRole.OWNER },
        });
        if (owners <= 1) {
            return NextResponse.json(
                { error: "El espacio necesita al menos una persona propietaria.", code: "LAST_OWNER" },
                { status: 409 },
            );
        }
    }

    await prisma.membership.update({
        where: { groupId_userId: { groupId: id, userId: targetUserId } },
        data: { role: role as MembershipRole },
    });
    return NextResponse.json({ success: true, role });
}
