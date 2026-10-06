import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { allowsGuests, joinByCodeAllowed } from "@/lib/space-policy";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { generateInviteToken, hashInviteToken, tokenPrefix } from "@/lib/invite-token";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { badRequest, forbidden, notFound, parseJson, readJson, requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";
import { CreateInviteBody, SPACE_BODY_OPTIONS } from "@/lib/space-schemas";

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

const options = { auth: "user", params: idParams, unauthorizedMessage: "Unauthorized" } as const;

export const POST = route(options, async ({ req, ctx, params: { id } }) => {
    const auth = await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"] });

    // Body parsed after the role gate. `kind` must be MEMBER | GUEST (default MEMBER).
    const body = await parseJson(req, CreateInviteBody, SPACE_BODY_OPTIONS);
    const kind = body.kind ?? InviteKind.MEMBER;

    const spaceType = auth.space.type as SpaceType;
    const spaceStatus = auth.space.status as SpaceStatus;
    const now = Date.now();

    if (kind === InviteKind.GUEST) {
        // GUEST links live behind the ephemeral-spaces flag and only ever make
        // sense in an ACTIVE space that allows guests (EPHEMERAL). A guest link
        // mints a shadow user on claim — never on a COUPLE/GROUP.
        if (!ephemeralSpacesEnabled()) {
            throw forbidden("Los espacios efímeros no están habilitados", "FEATURE_DISABLED");
        }
        if (!allowsGuests(spaceType) || spaceStatus !== SpaceStatus.ACTIVE) {
            throw badRequest("Este espacio no admite invitados", "GUESTS_NOT_ALLOWED");
        }
    } else {
        // MEMBER links only target spaces you can join as a registered member.
        // EPHEMERAL (guest-only) and SETTLING/ARCHIVED are rejected here.
        if (!joinByCodeAllowed(spaceType, spaceStatus)) {
            throw badRequest("Este espacio no admite enlaces de invitación de miembro", "JOIN_NOT_ALLOWED");
        }
    }

    // expiresAt: OBLIGATORIO for MEMBER; for GUEST it defaults to +30d when omitted.
    let expiresAt: Date;
    if (body.expiresAt == null) {
        if (kind === InviteKind.MEMBER) throw badRequest("expiresAt es obligatorio");
        expiresAt = new Date(now + GUEST_DEFAULT_EXPIRY_MS);
    } else {
        expiresAt = new Date(body.expiresAt as string);
        if (Number.isNaN(expiresAt.getTime())) throw badRequest("expiresAt inválido");
        if (expiresAt.getTime() <= now) throw badRequest("expiresAt debe estar en el futuro");
        if (expiresAt.getTime() - now > MAX_EXPIRY_MS) throw badRequest("expiresAt no puede superar los 30 días");
    }

    // maxUses: MEMBER defaults to 1 (single-use, safest); GUEST to 10. Clamp to ceiling.
    let maxUses = kind === InviteKind.GUEST ? GUEST_DEFAULT_MAX_USES : 1;
    if (body.maxUses !== undefined) {
        const n = Number(body.maxUses);
        if (!Number.isInteger(n) || n < 1 || n > MAX_USES_CEILING) {
            throw badRequest(`maxUses debe ser un entero entre 1 y ${MAX_USES_CEILING}`);
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
});

export const GET = route(options, async ({ ctx, params: { id } }) => {
    await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });

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
});

/** Invite id from the query string (?inviteId=...) or, failing that, a `{ inviteId }` body. */
async function readInviteId(req: Request): Promise<string | undefined> {
    const fromQuery = new URL(req.url).searchParams.get("inviteId");
    if (fromQuery) return fromQuery;
    // No/garbage body → fall through to the 400 below.
    const body = await readJson(req).catch(() => undefined);
    const fromBody = body && typeof body === "object" ? (body as { inviteId?: unknown }).inviteId : undefined;
    return typeof fromBody === "string" && fromBody ? fromBody : undefined;
}

export const DELETE = route(options, async ({ req, ctx, params: { id } }) => {
    await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });

    const inviteId = await readInviteId(req);
    if (!inviteId) throw badRequest("Falta inviteId");

    // Revoke only if the invite belongs to THIS space (authorize against resource).
    const revoked = await prisma.groupInvite.updateMany({
        where: { id: inviteId, groupId: id, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw notFound("Invitación no encontrada o ya revocada");

    return NextResponse.json({ success: true });
});
