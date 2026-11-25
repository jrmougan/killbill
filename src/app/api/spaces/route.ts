import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { ACTIVE_GROUP_COOKIE } from "@/lib/membership";
import { normalizeSpaceName, parseTripEndDate } from "@/lib/space-policy";
import { SpaceType } from "@/generated/prisma/enums";
import { route } from "@/lib/http";
import { CreateSpaceBody, SPACE_BODY_OPTIONS } from "@/lib/space-schemas";

/**
 * Typed space creation + listing (Fase 1). Replaces the untyped POST /api/couple
 * (kept as a deprecated COUPLE alias). The type is chosen at creation and is
 * never inferred from member count.
 */

// A guest session may list its (single) space.
export const GET = route({ auth: "user-or-guest", unauthorizedMessage: "Unauthorized" }, async ({ ctx }) => {
    const userId = ctx.userId;

    // All spaces where the caller is an ACTIVE member, in a stable order, with
    // type/status so the UI can section them (active vs Archived). ACTIVE-only
    // member count mirrors getGroupMembers semantics. The legacy `Couple.code`
    // is never exposed (no short codes: invites are /i/<token> links only).
    const memberships = await prisma.membership.findMany({
        where: { userId, status: "ACTIVE" },
        orderBy: [{ joinedAt: "asc" }, { groupId: "asc" }],
        include: {
            group: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    status: true,
                    archivedAt: true,
                    expiresAt: true,
                    createdAt: true,
                    _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
                },
            },
        },
    });

    const spaces = memberships.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        type: m.group.type,
        status: m.group.status,
        archivedAt: m.group.archivedAt,
        expiresAt: m.group.expiresAt,
        createdAt: m.group.createdAt,
        role: m.role,
        memberCount: m.group._count.memberships,
    }));

    return NextResponse.json({ spaces, userId });
});

// A guest session is caged to its EPHEMERAL space: it can never own a space (403).
// Only a type (COUPLE/GROUP/EPHEMERAL) is required; INDIVIDUAL is virtual and
// never materialized here.
export const POST = route(
    { auth: "user", unauthorizedMessage: "Unauthorized", body: CreateSpaceBody, bodyOptions: SPACE_BODY_OPTIONS },
    async ({ ctx, body }) => {
        const userId = ctx.userId;
        const spaceType = body.type;

        // expiresAt only makes sense for EPHEMERAL. A calendar date is stored as
        // the END of that day in Europe/Madrid; past dates are rejected. It caps
        // guest sessions (see jwt.ts) but never closes the space by itself.
        // SpacePolicyError (INVALID_END_DATE / INVALID_NAME) maps to its 400 + code.
        const expiresAt: Date | null =
            spaceType === SpaceType.EPHEMERAL && body.expiresAt != null && body.expiresAt !== ""
                ? parseTripEndDate(body.expiresAt)
                : null;
        const name = body.name == null || (typeof body.name === "string" && body.name.trim() === "")
            ? defaultName(spaceType)
            : normalizeSpaceName(body.name);

        // `Couple.code` is a legacy UNIQUE column. No short codes any more: fill it
        // with an unguessable 128-bit value that is never shown nor accepted as an
        // invite (invites are hashed /i/<token> links).
        const code = randomBytes(16).toString("hex").toUpperCase();

        // Create the space + the creator's OWNER membership atomically. Membership is
        // the sole linkage (User.coupleId no longer written).
        const space = await prisma.$transaction(async (tx) => {
            const created = await tx.couple.create({
                data: {
                    name,
                    code,
                    type: spaceType,
                    expiresAt,
                    createdById: userId,
                    // status defaults to ACTIVE.
                },
                select: { id: true, name: true, type: true, status: true, expiresAt: true, createdAt: true },
            });
            await tx.membership.create({
                data: { groupId: created.id, userId, role: "OWNER", status: "ACTIVE" },
            });
            return created;
        });

        // Make the new space the active one.
        (await cookies()).set(ACTIVE_GROUP_COOKIE, space.id, {
            httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
        });

        return NextResponse.json({ success: true, space });
    },
);

function defaultName(type: SpaceType): string {
    switch (type) {
        case SpaceType.COUPLE:
            return "Mi pareja";
        case SpaceType.EPHEMERAL:
            return "Mi viaje";
        default:
            return "Mi grupo";
    }
}
