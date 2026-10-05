import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ACTIVE_GROUP_COOKIE } from "@/lib/membership";
import { normalizeSpaceName, parseTripEndDate, SpacePolicyError } from "@/lib/space-policy";
import { SpaceType } from "@/generated/prisma/enums";

/**
 * Typed space creation + listing (Fase 1). Replaces the untyped POST /api/couple
 * (kept as a deprecated COUPLE alias). The type is chosen at creation and is
 * never inferred from member count.
 */

// Types a user may create directly. INDIVIDUAL is a virtual mode (no rows) and
// is never materialized here.
const CREATABLE_TYPES: SpaceType[] = [SpaceType.COUPLE, SpaceType.GROUP, SpaceType.EPHEMERAL];

export async function GET() {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.userId as string;

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
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // A guest session is caged to its EPHEMERAL space: it can never own a space.
    if (session.kind === "guest") {
        return NextResponse.json({ error: "Acción no permitida para invitados" }, { status: 403 });
    }
    const userId = session.userId as string;

    let body: { name?: unknown; type?: unknown; expiresAt?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const type = body.type;
    if (typeof type !== "string" || !CREATABLE_TYPES.includes(type as SpaceType)) {
        return NextResponse.json(
            { error: "type es obligatorio y debe ser COUPLE, GROUP o EPHEMERAL" },
            { status: 400 },
        );
    }
    const spaceType = type as SpaceType;

    let expiresAt: Date | null = null;
    let name: string;
    try {
        // expiresAt only makes sense for EPHEMERAL. A calendar date is stored as
        // the END of that day in Europe/Madrid; past dates are rejected. It caps
        // guest sessions (see jwt.ts) but never closes the space by itself.
        if (spaceType === SpaceType.EPHEMERAL && body.expiresAt != null && body.expiresAt !== "") {
            expiresAt = parseTripEndDate(body.expiresAt);
        }
        name = body.name == null || (typeof body.name === "string" && body.name.trim() === "")
            ? defaultName(spaceType)
            : normalizeSpaceName(body.name);
    } catch (e) {
        if (e instanceof SpacePolicyError) {
            return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
        }
        throw e;
    }

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
            // `code` is still returned to the creator only for the deprecated /api/couple/join
            // path (removed with the legacy join API); it is 128-bit, never shown in the UI.
            select: { id: true, name: true, code: true, type: true, status: true, expiresAt: true, createdAt: true },
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
}

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
