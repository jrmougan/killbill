import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { route } from "@/lib/http";
import { id, jsonObject } from "@/lib/http/schemas";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// auth: 'admin' — getSessionCtx verifies the JWT AND its tokenVersion (revoked
// tokens fail); only a regular browser session administers (not a guest, not an
// MCP token), and isAdmin is read from the DB, never trusted from the JWT claim.
// 401 "No autorizado" / 403 "Acceso denegado".

const DeleteBody = jsonObject({ id: id() });

// GET: List all invite codes
export const GET = route(
    { auth: 'admin', errorMessage: "Error al obtener invitaciones", logLabel: "Error fetching invites:" },
    async () => {
        const invites = await prisma.inviteCode.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                usedBy: { select: { id: true, name: true, email: true } },
            },
        });

        return NextResponse.json(invites);
    },
);

// POST: Create a new invite code
export const POST = route(
    { auth: 'admin', errorMessage: "Error al crear invitación", logLabel: "Error creating invite:" },
    async ({ ctx }) => {
        // Generate random 8-character code
        const code = randomBytes(4).toString("hex").toUpperCase();

        const invite = await prisma.inviteCode.create({
            data: {
                code,
                createdById: ctx.userId,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
        });

        return NextResponse.json(invite);
    },
);

// DELETE: Delete an invite code
export const DELETE = route(
    { auth: 'admin', body: DeleteBody, errorMessage: "Error al eliminar invitación", logLabel: "Error deleting invite:" },
    async ({ body: { id } }) => {
        await prisma.inviteCode.delete({ where: { id } });

        return NextResponse.json({ success: true });
    },
);
