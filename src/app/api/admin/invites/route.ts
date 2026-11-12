import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { conflict, notFound, route } from "@/lib/http";
import { createInviteFor, deleteInvite } from "@/app/admin/admin-data";
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
        // Random 8-character code, valid for 7 days: the same helper as the admin panel.
        return NextResponse.json(await createInviteFor(ctx.userId));
    },
);

// DELETE: Void an invite code nobody has used. Same rule as the admin panel
// (`deleteInvite`): a used code stays as the record of who registered with it
// (409 INVITE_USED); an id that does not exist is a 404, not a 500.
export const DELETE = route(
    { auth: 'admin', body: DeleteBody, errorMessage: "Error al eliminar invitación", logLabel: "Error deleting invite:" },
    async ({ body: { id } }) => {
        if (await deleteInvite(id)) return NextResponse.json({ success: true });

        const invite = await prisma.inviteCode.findUnique({ where: { id }, select: { id: true } });
        if (!invite) throw notFound("Invitación no encontrada");
        throw conflict("Esta invitación ya se ha usado y no se puede anular", "INVITE_USED");
    },
);
