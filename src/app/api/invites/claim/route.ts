import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { signGuestToken } from "@/lib/auth";
import { getSessionCtx } from "@/lib/authz";
import { ACTIVE_GROUP_COOKIE } from "@/lib/membership";
import { SPACE_CAPS, allowsGuests, SpacePolicyError } from "@/lib/space-policy";
import { evaluateInvite, generateInviteToken, hashInviteToken, inviteInvalidMessage } from "@/lib/invite-token";
import {
    accountJoinAllowed,
    mayOpenGuestSession,
    sessionKindOf,
    SESSION_EXISTS_MESSAGE,
    type SessionKind,
} from "@/lib/invite-policy";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { InviteKind, MembershipRole, MembershipStatus, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Redeem an invite link: POST {token, name?, asMember?, replaceSession?}.
 *
 * Resolution paths from a single opaque 256-bit token:
 *
 * 1. GUEST invite (EPHEMERAL, behind `EPHEMERAL_SPACES_ENABLED`):
 *    a. `asMember: true` + a REGISTERED session → the account joins the trip as
 *       MEMBER (explicit consent, consumes one use). "Unirme con mi cuenta".
 *    b. otherwise → guest entry: mints a SHADOW User `{name, isGuest:true}` + a
 *       GUEST Membership, emits a one-time personal recovery link and opens a
 *       72h guest session. If a REGISTERED session is present this would replace
 *       it, so it is refused with 409 `SESSION_EXISTS` unless the client sends
 *       `replaceSession: true` after the user confirmed (IE-02).
 * 2. Guest recovery token (`Membership.guestTokenHash`): re-opens the guest
 *    session on a new device; same 409 guard over a registered session.
 * 3. MEMBER invite: explicit-consent join for an authenticated REGISTERED user.
 *    A guest session is refused (it must create its account first).
 *
 * The legacy 6-hex `Couple.code` is NOT accepted any more (IE-04/T-09: no short
 * codes — it was guessable and never expired): an unknown token is a 404.
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

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function sessionExists() {
    return json({ error: SESSION_EXISTS_MESSAGE, code: "SESSION_EXISTS" }, 409);
}

export async function POST(request: Request) {
    let body: { token?: unknown; name?: unknown; asMember?: unknown; replaceSession?: unknown };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Cuerpo inválido" }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "Cuerpo inválido" }, 400);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
        return json({ error: "Falta el token de invitación" }, 400);
    }
    const tokenHash = hashInviteToken(token);
    const asMember = body.asMember === true;
    const replaceSession = body.replaceSession === true;

    // getSessionCtx (not the raw JWT): an expelled guest / archived trip / revoked
    // registered token reads as "no session" here.
    const session = await getSessionCtx();
    const current = sessionKindOf(session);
    const sessionUserId = current === "none" ? null : session!.userId;

    // Resolve a GroupInvite first (MEMBER or GUEST).
    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash },
        include: { group: { select: { id: true, type: true, status: true, expiresAt: true } } },
    });

    // ── Path 1: GUEST invite ──────────────────────────────────────────────────
    if (invite && invite.kind === InviteKind.GUEST) {
        if (!ephemeralSpacesEnabled()) {
            return json({ error: "Los espacios efímeros no están habilitados", code: "FEATURE_DISABLED" }, 403);
        }
        if (asMember) {
            if (current !== "registered") {
                return json({ error: "Inicia sesión para unirte con tu cuenta", code: "LOGIN_REQUIRED" }, 401);
            }
            return joinAsMember(invite, sessionUserId!);
        }
        if (current === "guest" && session?.groupId === invite.group.id) {
            // Already inside this trip as a guest: never mint a second shadow user.
            return json({ success: true, guest: true, alreadyMember: true, groupId: invite.group.id });
        }
        if (!mayOpenGuestSession(current, replaceSession)) return sessionExists();
        return claimAsGuest(invite, body.name, request);
    }

    // ── Path 2: guest recovery token (re-open session on a new device) ────────
    if (!invite) {
        const recovery = await resolveGuestRecovery(tokenHash, current, replaceSession);
        if (recovery) return recovery;
        return json({ error: "Enlace de invitación no encontrado", code: "NOT_FOUND" }, 404);
    }

    // ── Path 3: MEMBER invite (requires a registered session) ─────────────────
    if (current === "none") {
        return json({ error: "Inicia sesión para unirte", code: "LOGIN_REQUIRED" }, 401);
    }
    if (current === "guest") {
        return json(
            { error: "Estás como invitado: crea tu cuenta para unirte a otro espacio", code: "GUEST_NOT_ALLOWED" },
            403,
        );
    }
    return joinAsMember(invite, sessionUserId!);
}

/** Invite row shape needed for a claim (from the include above). */
type ClaimInvite = {
    id: string;
    kind: InviteKind;
    maxUses: number;
    usedCount: number;
    expiresAt: Date;
    revokedAt: Date | null;
    group: { id: string; type: SpaceType; status: SpaceStatus; expiresAt: Date | null };
};

/**
 * Join the invite's space with a REGISTERED account (role MEMBER). Used for
 * MEMBER links (COUPLE/GROUP) and for a GUEST link opened by someone who already
 * has an account (EPHEMERAL). Transactional: locks the space, re-checks the cap,
 * and consumes one invite use with a conditional `updateMany`.
 */
async function joinAsMember(invite: ClaimInvite, userId: string) {
    const validity = evaluateInvite(invite);
    if (!validity.ok) {
        return json({ error: inviteInvalidMessage(validity.reason), code: validity.reason }, 400);
    }
    const groupId = invite.group.id;
    const type = invite.group.type as SpaceType;
    const status = invite.group.status as SpaceStatus;

    if (!accountJoinAllowed(invite.kind, type, status)) {
        return json({ error: "Este espacio no admite unirse mediante este enlace", code: "JOIN_NOT_ALLOWED" }, 400);
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Different invites share the same capacity. Lock the space BEFORE
            // reading memberships so MySQL's snapshot sees the previous claim.
            await tx.$queryRaw`SELECT id FROM Couple WHERE id = ${groupId} FOR UPDATE`;
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

            return { alreadyMember: false };
        });

        (await cookies()).set(ACTIVE_GROUP_COOKIE, groupId, ACTIVE_GROUP_COOKIE_OPTS);

        return json({ success: true, groupId, alreadyMember: result.alreadyMember });
    } catch (e) {
        if (e instanceof SpacePolicyError) return policyErrorResponse(e);
        console.error("Error al canjear invitación:", e);
        return json({ error: "Error al unirse al espacio" }, 500);
    }
}

function policyErrorResponse(e: SpacePolicyError) {
    if (e.message === "exhausted") {
        return json({ error: "Este enlace de invitación ya no admite más usos", code: "EXHAUSTED" }, 400);
    }
    return json({ error: "Este espacio ya está completo", code: "SPACE_FULL" }, 400);
}

/**
 * Path 1b: mint a shadow user + GUEST membership from a GUEST invite. The whole
 * thing is transactional; the invite use is consumed with a conditional
 * `updateMany` so concurrent claims can't over-consume it.
 */
async function claimAsGuest(invite: ClaimInvite, rawName: unknown, request: Request) {
    if (!ephemeralSpacesEnabled()) {
        return json({ error: "Los espacios efímeros no están habilitados", code: "FEATURE_DISABLED" }, 403);
    }

    const group = invite.group;
    if (!allowsGuests(group.type) || group.status !== SpaceStatus.ACTIVE) {
        return json({ error: "Este espacio no admite invitados", code: "GUESTS_NOT_ALLOWED" }, 400);
    }

    const validity = evaluateInvite(invite);
    if (!validity.ok) {
        return json({ error: inviteInvalidMessage(validity.reason), code: validity.reason }, 400);
    }

    const name = typeof rawName === "string" ? rawName.trim().slice(0, MAX_GUEST_NAME_LEN) : "";
    if (!name) {
        return json({ error: "Escribe tu nombre para entrar" }, 400);
    }

    // Rate-limit guest creation per IP so a leaked link can't spawn shadow users
    // en masse (each is a real DB row): 10 new guests / 10 min per IP.
    const ip = getClientIp(request.headers);
    if (!rateLimit(`guest-claim:${ip}`, 10, 10 * 60 * 1000).allowed) {
        return json({ error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." }, 429);
    }

    // Personal recovery link (multi-device): shown once, only its hash persisted.
    const recoveryToken = generateInviteToken();
    const recoveryHash = hashInviteToken(recoveryToken);

    let guestUserId: string;
    try {
        guestUserId = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM Couple WHERE id = ${group.id} FOR UPDATE`;
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
        if (e instanceof SpacePolicyError) return policyErrorResponse(e);
        console.error("Error al entrar como invitado:", e);
        return json({ error: "No se pudo entrar como invitado" }, 500);
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
    return json({ success: true, guest: true, groupId: group.id, recoveryToken });
}

/**
 * Path 2: re-open a guest session from a personal recovery token
 * (`Membership.guestTokenHash`). Only for an ACTIVE guest membership of a
 * still-guest user on a non-ARCHIVED space (archiving revokes guest access).
 * Returns null when the token is not a recovery token.
 */
async function resolveGuestRecovery(tokenHash: string, current: SessionKind, replaceSession: boolean) {
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
        return json({ error: "Este enlace de invitado ya no es válido", code: "GUEST_REVOKED" }, 403);
    }
    if (!mayOpenGuestSession(current, replaceSession)) return sessionExists();

    const sessionToken = await signGuestToken(
        { userId: membership.userId, groupId: membership.group.id, role: MembershipRole.GUEST },
        membership.group.expiresAt,
    );
    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, SESSION_COOKIE);
    cookieStore.set(ACTIVE_GROUP_COOKIE, membership.group.id, ACTIVE_GROUP_COOKIE_OPTS);
    cookieStore.delete("user_id");

    return json({ success: true, guest: true, recovered: true, groupId: membership.group.id });
}
