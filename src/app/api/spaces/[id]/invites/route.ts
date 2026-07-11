import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { allowsGuests, joinByCodeAllowed } from "@/lib/space-policy";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { generateInviteToken, hashInviteToken, tokenPrefix } from "@/lib/invite-token";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Invite-link management for registered members (Fase 2, kind MEMBER).
 *
 * - POST: OWNER/ADMIN mint a single-shown token (`base64url(randomBytes(32))`);
 *   only the sha256 + prefix are stored. `expiresAt` is OBLIGATORIO.
 * - GET:  OWNER/ADMIN list the space's live links by prefix (never the token).
 * - DELETE: OWNER/ADMIN revoke a link (sets `revokedAt`).
 *
 * GUEST invites (EPHEMERAL) are Fase 3 and are rejected here. A MEMBER link only
 * makes sense where join-by-membership is allowed: ACTIVE COUPLE/GROUP.
 */

/** Hard ceiling so a single link can't be turned into an unbounded funnel. */
const MAX_USES_CEILING = 50;
/** Furthest an invite may be set to expire (30 days, matches GUEST default). */
const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** GUEST link defaults (product #8): maxUses 10, expiry 30 days. */
const GUEST_DEFAULT_MAX_USES = 10;
const GUEST_DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"] });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    let body: { maxUses?: unknown; expiresAt?: unknown; kind?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const kind = body.kind === undefined ? InviteKind.MEMBER : body.kind;
    if (kind !== InviteKind.MEMBER && kind !== InviteKind.GUEST) {
        return NextResponse.json({ error: "Tipo de invitación no válido" }, { status: 400 });
    }

    const spaceType = auth.space.type as SpaceType;
    const spaceStatus = auth.space.status as SpaceStatus;
    const now = Date.now();

    if (kind === InviteKind.GUEST) {
        // GUEST links live behind the ephemeral-spaces flag and only ever make
        // sense in an ACTIVE space that allows guests (EPHEMERAL). A guest link
        // mints a shadow user on claim — never on a COUPLE/GROUP.
        if (!ephemeralSpacesEnabled()) {
            return NextResponse.json(
                { error: "Los espacios efímeros no están habilitados", code: "FEATURE_DISABLED" },
                { status: 403 },
            );
        }
        if (!allowsGuests(spaceType) || spaceStatus !== SpaceStatus.ACTIVE) {
            return NextResponse.json(
                { error: "Este espacio no admite invitados", code: "GUESTS_NOT_ALLOWED" },
                { status: 400 },
            );
        }
    } else {
        // MEMBER links only target spaces you can join as a registered member.
        // EPHEMERAL (guest-only) and SETTLING/ARCHIVED are rejected here.
        if (!joinByCodeAllowed(spaceType, spaceStatus)) {
            return NextResponse.json(
                { error: "Este espacio no admite enlaces de invitación de miembro", code: "JOIN_NOT_ALLOWED" },
                { status: 400 },
            );
        }
    }

    // expiresAt: OBLIGATORIO for MEMBER; for GUEST it defaults to +30d when omitted.
    let expiresAt: Date;
    if (body.expiresAt == null) {
        if (kind === InviteKind.MEMBER) {
            return NextResponse.json({ error: "expiresAt es obligatorio" }, { status: 400 });
        }
        expiresAt = new Date(now + GUEST_DEFAULT_EXPIRY_MS);
    } else {
        expiresAt = new Date(body.expiresAt as string);
        if (Number.isNaN(expiresAt.getTime())) {
            return NextResponse.json({ error: "expiresAt inválido" }, { status: 400 });
        }
        if (expiresAt.getTime() <= now) {
            return NextResponse.json({ error: "expiresAt debe estar en el futuro" }, { status: 400 });
        }
        if (expiresAt.getTime() - now > MAX_EXPIRY_MS) {
            return NextResponse.json({ error: "expiresAt no puede superar los 30 días" }, { status: 400 });
        }
    }

    // maxUses: MEMBER defaults to 1 (single-use, safest); GUEST to 10. Clamp to ceiling.
    let maxUses = kind === InviteKind.GUEST ? GUEST_DEFAULT_MAX_USES : 1;
    if (body.maxUses !== undefined) {
        const n = Number(body.maxUses);
        if (!Number.isInteger(n) || n < 1 || n > MAX_USES_CEILING) {
            return NextResponse.json(
                { error: `maxUses debe ser un entero entre 1 y ${MAX_USES_CEILING}` },
                { status: 400 },
            );
        }
        maxUses = n;
    }

    // Generate the plaintext token; store only its hash + prefix.
    const token = generateInviteToken();
    const invite = await prisma.groupInvite.create({
        data: {
            groupId: id,
            tokenHash: hashInviteToken(token),
            tokenPrefix: tokenPrefix(token),
            kind,
            maxUses,
            expiresAt,
            createdById: auth.userId,
        },
    });

    // `token` is returned ONCE and never again — the DB only keeps its hash.
    return NextResponse.json({
        success: true,
        token,
        invite: {
            id: invite.id,
            tokenPrefix: invite.tokenPrefix,
            kind: invite.kind,
            maxUses: invite.maxUses,
            usedCount: invite.usedCount,
            expiresAt: invite.expiresAt,
            createdAt: invite.createdAt,
        },
    });
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const invites = await prisma.groupInvite.findMany({
        where: { groupId: id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            tokenPrefix: true,
            kind: true,
            maxUses: true,
            usedCount: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });

    return NextResponse.json({ invites });
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    // Invite id may come from the query string (?inviteId=...) or the body.
    const url = new URL(request.url);
    let inviteId = url.searchParams.get("inviteId") ?? undefined;
    if (!inviteId) {
        try {
            const body = (await request.json()) as { inviteId?: unknown };
            if (typeof body.inviteId === "string") inviteId = body.inviteId;
        } catch {
            // no body — fall through to validation below
        }
    }
    if (!inviteId) {
        return NextResponse.json({ error: "Falta inviteId" }, { status: 400 });
    }

    // Revoke only if the invite belongs to THIS space (authorize against resource).
    const revoked = await prisma.groupInvite.updateMany({
        where: { id: inviteId, groupId: id, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
        return NextResponse.json({ error: "Invitación no encontrada o ya revocada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
