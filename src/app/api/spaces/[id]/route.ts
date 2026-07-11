import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import {
    assertStatusTransition,
    assertTypeUpgrade,
    SpacePolicyError,
} from "@/lib/space-policy";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Space lifecycle management (Fase 1): status transitions
 * (ACTIVE<->SETTLING, ->ARCHIVED) and the single "Convertir en grupo"
 * (COUPLE->GROUP) upgrade. OWNER/ADMIN only. Optional rename.
 *
 * Body (one of):
 *   { status: "SETTLING" | "ACTIVE" | "ARCHIVED" }   // lifecycle transition
 *   { type: "GROUP" }                                 // upgrade (COUPLE->GROUP)
 *   { name: "..." }                                   // rename
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    // allowArchived: true so we can operate on SETTLING/ARCHIVED spaces (e.g.
    // reopen a SETTLING space). The policy transition rules do the real gating.
    const auth = await requireSpaceAccess(ctx, id, {
        roles: ["OWNER", "ADMIN"],
        allowArchived: true,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    let body: { status?: unknown; type?: unknown; name?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const data: { status?: SpaceStatus; type?: SpaceType; name?: string; archivedAt?: Date | null } = {};

    try {
        // Lifecycle transition.
        if (body.status !== undefined) {
            const to = body.status;
            if (typeof to !== "string" || !(to in SpaceStatus)) {
                return NextResponse.json({ error: "status inválido" }, { status: 400 });
            }
            const toStatus = to as SpaceStatus;
            assertStatusTransition(auth.space.status as SpaceStatus, toStatus);
            data.status = toStatus;
            // Stamp archivedAt on archive; clear it when reopening to ACTIVE.
            if (toStatus === SpaceStatus.ARCHIVED) data.archivedAt = new Date();
            else if (toStatus === SpaceStatus.ACTIVE) data.archivedAt = null;
        }

        // Type upgrade (COUPLE -> GROUP only).
        if (body.type !== undefined) {
            const to = body.type;
            if (typeof to !== "string" || !(to in SpaceType)) {
                return NextResponse.json({ error: "type inválido" }, { status: 400 });
            }
            assertTypeUpgrade(auth.space.type as SpaceType, to as SpaceType);
            data.type = to as SpaceType;
        }
    } catch (e) {
        if (e instanceof SpacePolicyError) {
            return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
        }
        throw e;
    }

    // Optional rename.
    if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.trim().length === 0) {
            return NextResponse.json({ error: "name inválido" }, { status: 400 });
        }
        data.name = body.name.trim();
    }

    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    const space = await prisma.couple.update({ where: { id }, data });
    return NextResponse.json({ success: true, space });
}
