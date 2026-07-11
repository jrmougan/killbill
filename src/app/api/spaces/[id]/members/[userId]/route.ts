import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { MembershipRole, MembershipStatus } from "@/generated/prisma/enums";

/**
 * Remove a member from a space (Fase 1). NEVER a physical delete — a self-leave
 * becomes LEFT, an expulsion by OWNER/ADMIN becomes REMOVED. Preserving the row
 * keeps the accounting intact (Split/Settlement/Ledger hang off User.id).
 *
 * - Self-leave: any ACTIVE member may leave (status -> LEFT).
 * - Expulsion: OWNER/ADMIN may remove another member (status -> REMOVED).
 * - An ADMIN cannot remove an OWNER (only an OWNER can).
 */
export async function DELETE(
    _request: Request,
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

    // Load the target's membership in THIS space.
    const target = await prisma.membership.findUnique({
        where: { groupId_userId: { groupId: id, userId: targetUserId } },
    });
    if (!target || target.status !== MembershipStatus.ACTIVE) {
        return NextResponse.json({ error: "Ese miembro no está en el espacio" }, { status: 404 });
    }

    let newStatus: MembershipStatus;
    if (isSelf) {
        newStatus = MembershipStatus.LEFT;
    } else {
        // Expelling another member requires OWNER/ADMIN.
        if (auth.role !== MembershipRole.OWNER && auth.role !== MembershipRole.ADMIN) {
            return NextResponse.json({ error: "No tienes permisos para expulsar miembros" }, { status: 403 });
        }
        // Only an OWNER can remove another OWNER.
        if (target.role === MembershipRole.OWNER && auth.role !== MembershipRole.OWNER) {
            return NextResponse.json({ error: "Solo un propietario puede quitar a otro propietario" }, { status: 403 });
        }
        newStatus = MembershipStatus.REMOVED;
    }

    await prisma.membership.update({
        where: { groupId_userId: { groupId: id, userId: targetUserId } },
        data: { status: newStatus, leftAt: new Date() },
    });

    return NextResponse.json({ success: true, status: newStatus });
}
