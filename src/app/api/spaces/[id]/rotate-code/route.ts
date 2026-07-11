import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { SpaceType } from "@/generated/prisma/enums";

/**
 * Rotate a space's invite code (Fase 1). OWNER/ADMIN only. Invalidates the old
 * code so a leaked one stops working. Only meaningful where join-by-code is
 * supported (COUPLE/GROUP); EPHEMERAL uses expirable invite links, not the code.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, {
        roles: ["OWNER", "ADMIN"],
        allowArchived: true,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const type = auth.space.type as SpaceType;
    if (type !== SpaceType.COUPLE && type !== SpaceType.GROUP) {
        return NextResponse.json(
            { error: "Este tipo de espacio no usa código de invitación" },
            { status: 400 },
        );
    }

    // Generate a fresh unique code, retrying on the rare unique-constraint clash.
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = randomBytes(3).toString("hex").toUpperCase();
        const clash = await prisma.couple.findUnique({
            where: { code: candidate },
            select: { id: true },
        });
        if (!clash) {
            code = candidate;
            break;
        }
    }
    if (!code) {
        return NextResponse.json({ error: "No se pudo generar un código único" }, { status: 500 });
    }

    const space = await prisma.couple.update({ where: { id }, data: { code } });
    return NextResponse.json({ success: true, code: space.code });
}
