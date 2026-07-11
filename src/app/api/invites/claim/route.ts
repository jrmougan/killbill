import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ACTIVE_GROUP_COOKIE } from "@/lib/membership";
import { SPACE_CAPS, joinByCodeAllowed, SpacePolicyError } from "@/lib/space-policy";
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import { InviteKind, MembershipRole, MembershipStatus, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Redeem an invite link as an authenticated, registered user (Fase 2).
 *
 * This is the EXPLICIT-CONSENT join: the visitor arrives at `/i/[token]`, sees
 * the space, and confirms "Unirte a {espacio} como miembro" — which POSTs here.
 * It replaces the silent auto-join that `/login?code=` used to do.
 *
 * - Requires a session (unauthenticated visitors are sent to login/register by
 *   the consent screen).
 * - Resolves a GroupInvite (kind MEMBER) by hash, or a legacy classic
 *   `Couple.code` (old `/login?code=X` links now route through consent).
 * - Redeem is transactional with a conditional `updateMany` (the InviteCode
 *   anti-race pattern): the invite is only consumed if it's still redeemable and
 *   the space still has room, so concurrent claims can't overfill or over-consume.
 * - Respects SPACE_CAPS and rejects EPHEMERAL / non-ACTIVE spaces (same rule as
 *   join-by-code): guest joins to EPHEMERAL are Fase 3.
 */
export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId as string;

    let body: { token?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
        return NextResponse.json({ error: "Falta el token de invitación" }, { status: 400 });
    }

    // Resolve the join target: a GroupInvite (preferred) or a legacy classic code.
    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: { group: { select: { id: true, type: true, status: true } } },
    });

    let groupId: string;
    let type: SpaceType;
    let status: SpaceStatus;
    let inviteId: string | null = null;
    let inviteMaxUses = 0;

    if (invite) {
        if (invite.kind !== InviteKind.MEMBER) {
            // GUEST invites (EPHEMERAL) are handled by the Fase 3 guest flow.
            return NextResponse.json(
                { error: "Este enlace no es una invitación de miembro" },
                { status: 400 },
            );
        }
        const validity = evaluateInvite(invite);
        if (!validity.ok) {
            return NextResponse.json(
                { error: inviteInvalidMessage(validity.reason), code: validity.reason },
                { status: 400 },
            );
        }
        groupId = invite.group.id;
        type = invite.group.type as SpaceType;
        status = invite.group.status as SpaceStatus;
        inviteId = invite.id;
        inviteMaxUses = invite.maxUses;
    } else {
        const couple = await prisma.couple.findUnique({
            where: { code: token.toUpperCase() },
            select: { id: true, type: true, status: true },
        });
        if (!couple) {
            return NextResponse.json({ error: "Enlace de invitación no encontrado" }, { status: 404 });
        }
        groupId = couple.id;
        type = couple.type as SpaceType;
        status = couple.status as SpaceStatus;
    }

    // Same gate as join-by-code: only ACTIVE COUPLE/GROUP accept new members here.
    // EPHEMERAL uses guest links (Fase 3); SETTLING/ARCHIVED are closed.
    if (!joinByCodeAllowed(type, status)) {
        return NextResponse.json(
            { error: "Este espacio no admite unirse mediante este enlace", code: "JOIN_NOT_ALLOWED" },
            { status: 400 },
        );
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.membership.findFirst({
                where: { userId, groupId, status: MembershipStatus.ACTIVE },
                select: { id: true },
            });
            if (existing) return { alreadyMember: true };

            const memberCount = await tx.membership.count({
                where: { groupId, status: MembershipStatus.ACTIVE },
            });
            if (memberCount >= SPACE_CAPS[type]) throw new SpacePolicyError("SPACE_FULL", "full");

            // Upsert handles a previous LEFT/REMOVED rejoin.
            await tx.membership.upsert({
                where: { groupId_userId: { groupId, userId } },
                create: { groupId, userId, role: MembershipRole.MEMBER, status: MembershipStatus.ACTIVE },
                update: { status: MembershipStatus.ACTIVE, role: MembershipRole.MEMBER, leftAt: null },
            });

            // Consume one use of the GroupInvite atomically. The WHERE re-checks
            // redeemability so a racing claim that already exhausted/expired/revoked
            // it loses here and the whole transaction rolls back.
            if (inviteId) {
                const consumed = await tx.groupInvite.updateMany({
                    where: {
                        id: inviteId,
                        revokedAt: null,
                        expiresAt: { gt: new Date() },
                        usedCount: { lt: inviteMaxUses },
                    },
                    data: { usedCount: { increment: 1 } },
                });
                if (consumed.count === 0) throw new SpacePolicyError("SPACE_FULL", "exhausted", 400);
            }

            return { alreadyMember: false };
        });

        // Make the just-joined space the active one.
        (await cookies()).set(ACTIVE_GROUP_COOKIE, groupId, {
            httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
        });

        return NextResponse.json({ success: true, groupId, alreadyMember: result.alreadyMember });
    } catch (e) {
        if (e instanceof SpacePolicyError) {
            if (e.message === "exhausted") {
                return NextResponse.json(
                    { error: "Este enlace de invitación ya no admite más usos", code: "EXHAUSTED" },
                    { status: 400 },
                );
            }
            return NextResponse.json(
                { error: "Este espacio ya está completo", code: "SPACE_FULL" },
                { status: 400 },
            );
        }
        console.error("Error al canjear invitación:", e);
        return NextResponse.json({ error: "Error al unirse al espacio" }, { status: 500 });
    }
}
