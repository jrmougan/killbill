import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getSession, signGuestToken } from "@/lib/auth";
import { ACTIVE_GROUP_COOKIE } from "@/lib/membership";
import { SPACE_CAPS, allowsGuests, joinByCodeAllowed, SpacePolicyError } from "@/lib/space-policy";
import { evaluateInvite, generateInviteToken, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { InviteKind, MembershipRole, MembershipStatus, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Redeem an invite link (Fase 2 MEMBER + Fase 3 GUEST).
 *
 * Three resolution paths from a single opaque token:
 *
 * 1. GUEST invite (EPHEMERAL, behind `EPHEMERAL_SPACES_ENABLED`): NO session
 *    required. Mints a SHADOW User `{name, isGuest:true, email/password NULL}` +
 *    a Membership `role=GUEST`, emits a one-time personal recovery link
 *    (`Membership.guestTokenHash`), and opens a 72h guest session (JWT
 *    `kind:'guest'`, capped at the space's expiresAt).
 * 2. Guest recovery token (a `Membership.guestTokenHash`): NO session required.
 *    Re-opens the guest session on a new device for an existing shadow user.
 * 3. MEMBER invite / legacy classic `Couple.code`: EXPLICIT-CONSENT join for an
 *    authenticated, registered user (replaces the old silent `/login?code=`
 *    auto-join). Consumes one invite use with a conditional `updateMany`.
 */

const SESSION_COOKIE = {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 72 * 60 * 60, // guest session: 72h
};
const ACTIVE_GROUP_COOKIE_OPTS = {
    httpOnly: true as const, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365,
};
const MAX_GUEST_NAME_LEN = 40;

export async function POST(request: Request) {
    let body: { token?: unknown; name?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
        return NextResponse.json({ error: "Falta el token de invitación" }, { status: 400 });
    }
    const tokenHash = hashInviteToken(token);

    // Resolve a GroupInvite first (MEMBER or GUEST).
    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash },
        include: { group: { select: { id: true, type: true, status: true, expiresAt: true } } },
    });

    // ── Path 1: GUEST claim (no session, mints a shadow user) ─────────────────
    if (invite && invite.kind === InviteKind.GUEST) {
        return claimAsGuest(invite, body.name, request);
    }

    // ── Path 2: guest recovery token (re-open session on a new device) ────────
    if (!invite) {
        const recovery = await resolveGuestRecovery(tokenHash);
        if (recovery) return recovery;
    }

    // ── Path 3: MEMBER invite / legacy classic code (requires a session) ──────
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId as string;

    let groupId: string;
    let type: SpaceType;
    let status: SpaceStatus;
    let inviteId: string | null = null;
    let inviteMaxUses = 0;

    if (invite) {
        // Only MEMBER reaches here (GUEST handled above).
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
    // EPHEMERAL uses guest links; SETTLING/ARCHIVED are closed.
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

            await tx.membership.upsert({
                where: { groupId_userId: { groupId, userId } },
                create: { groupId, userId, role: MembershipRole.MEMBER, status: MembershipStatus.ACTIVE },
                update: { status: MembershipStatus.ACTIVE, role: MembershipRole.MEMBER, leftAt: null },
            });

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

        (await cookies()).set(ACTIVE_GROUP_COOKIE, groupId, ACTIVE_GROUP_COOKIE_OPTS);

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

/** Invite row shape needed for a GUEST claim (from the include above). */
type GuestInvite = {
    id: string;
    maxUses: number;
    usedCount: number;
    expiresAt: Date;
    revokedAt: Date | null;
    group: { id: string; type: SpaceType; status: SpaceStatus; expiresAt: Date | null };
};

/**
 * Path 1: mint a shadow user + GUEST membership from a GUEST invite. No prior
 * session. The whole thing is transactional; the invite use is consumed with a
 * conditional `updateMany` so concurrent claims can't over-consume it.
 */
async function claimAsGuest(invite: GuestInvite, rawName: unknown, request: Request) {
    if (!ephemeralSpacesEnabled()) {
        return NextResponse.json(
            { error: "Los espacios efímeros no están habilitados", code: "FEATURE_DISABLED" },
            { status: 403 },
        );
    }

    const group = invite.group;
    if (!allowsGuests(group.type) || group.status !== SpaceStatus.ACTIVE) {
        return NextResponse.json(
            { error: "Este espacio no admite invitados", code: "GUESTS_NOT_ALLOWED" },
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

    const name = typeof rawName === "string" ? rawName.trim().slice(0, MAX_GUEST_NAME_LEN) : "";
    if (!name) {
        return NextResponse.json({ error: "Escribe tu nombre para entrar" }, { status: 400 });
    }

    // Rate-limit guest creation per IP so a leaked link can't spawn shadow users
    // en masse (each is a real DB row): 10 new guests / 10 min per IP.
    const ip = getClientIp(request.headers);
    if (!rateLimit(`guest-claim:${ip}`, 10, 10 * 60 * 1000).allowed) {
        return NextResponse.json(
            { error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." },
            { status: 429 },
        );
    }

    // Personal recovery link (multi-device): shown once, only its hash persisted.
    const recoveryToken = generateInviteToken();
    const recoveryHash = hashInviteToken(recoveryToken);

    let guestUserId: string;
    try {
        guestUserId = await prisma.$transaction(async (tx) => {
            const memberCount = await tx.membership.count({
                where: { groupId: group.id, status: MembershipStatus.ACTIVE },
            });
            if (memberCount >= SPACE_CAPS[group.type]) throw new SpacePolicyError("SPACE_FULL", "full");

            const user = await tx.user.create({
                data: { name, isGuest: true },
                select: { id: true },
            });
            await tx.membership.create({
                data: {
                    groupId: group.id,
                    userId: user.id,
                    role: MembershipRole.GUEST,
                    status: MembershipStatus.ACTIVE,
                    guestTokenHash: recoveryHash,
                },
            });

            const consumed = await tx.groupInvite.updateMany({
                where: {
                    id: invite.id,
                    revokedAt: null,
                    expiresAt: { gt: new Date() },
                    usedCount: { lt: invite.maxUses },
                },
                data: { usedCount: { increment: 1 } },
            });
            if (consumed.count === 0) throw new SpacePolicyError("SPACE_FULL", "exhausted", 400);

            return user.id;
        });
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
        console.error("Error al entrar como invitado:", e);
        return NextResponse.json({ error: "No se pudo entrar como invitado" }, { status: 500 });
    }

    // Open the guest session (72h, hard-capped at the space's expiresAt).
    const sessionToken = await signGuestToken(
        { userId: guestUserId, groupId: group.id, role: MembershipRole.GUEST },
        group.expiresAt,
    );
    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, SESSION_COOKIE);
    cookieStore.set(ACTIVE_GROUP_COOKIE, group.id, ACTIVE_GROUP_COOKIE_OPTS);
    cookieStore.delete("user_id");

    // `recoveryToken` is returned ONCE — the DB only keeps its hash.
    return NextResponse.json({ success: true, guest: true, groupId: group.id, recoveryToken });
}

/**
 * Path 2: re-open a guest session from a personal recovery token
 * (`Membership.guestTokenHash`). Only for an ACTIVE guest membership on a
 * non-ARCHIVED space (archiving revokes guest access). Returns null when the
 * token is not a recovery token so the caller can continue to other paths.
 */
async function resolveGuestRecovery(tokenHash: string) {
    if (!ephemeralSpacesEnabled()) return null;

    const membership = await prisma.membership.findUnique({
        where: { guestTokenHash: tokenHash },
        select: {
            userId: true,
            role: true,
            status: true,
            group: { select: { id: true, status: true, expiresAt: true } },
        },
    });
    if (!membership) return null;

    if (
        membership.role !== MembershipRole.GUEST ||
        membership.status !== MembershipStatus.ACTIVE ||
        membership.group.status === SpaceStatus.ARCHIVED
    ) {
        return NextResponse.json(
            { error: "Este enlace de invitado ya no es válido", code: "GUEST_REVOKED" },
            { status: 403 },
        );
    }

    const sessionToken = await signGuestToken(
        { userId: membership.userId, groupId: membership.group.id, role: MembershipRole.GUEST },
        membership.group.expiresAt,
    );
    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, SESSION_COOKIE);
    cookieStore.set(ACTIVE_GROUP_COOKIE, membership.group.id, ACTIVE_GROUP_COOKIE_OPTS);
    cookieStore.delete("user_id");

    return NextResponse.json({ success: true, guest: true, recovered: true, groupId: membership.group.id });
}
