import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { verifyToken } from "@/lib/auth";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function checkAdmin() {
    const cookieStore = await cookies();
    const token = cookieStore.get("session_token")?.value;

    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || !payload.userId) return null;

    // Optional: Verify against DB if we want strictly 100% fresh state
    // For admin, it's safer to check DB field.
    const user = await prisma.user.findUnique({
        where: { id: payload.userId as string },
        select: { id: true, email: true, isAdmin: true }
    });

    return user;
}

// GET: List all invite codes
export async function GET() {
    try {
        const user = await checkAdmin();

        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        if (!user.isAdmin) {
            return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
        }

        const invites = await prisma.inviteCode.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                usedBy: { select: { id: true, name: true, email: true } },
            },
        });

        return NextResponse.json(invites);
    } catch (error) {
        console.error("Error fetching invites:", error);
        return NextResponse.json({ error: "Error al obtener invitaciones" }, { status: 500 });
    }
}

// POST: Create a new invite code
export async function POST() {
    try {
        const user = await checkAdmin();

        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        if (!user.isAdmin) {
            return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
        }

        // Generate random 8-character code
        const code = randomBytes(4).toString("hex").toUpperCase();

        const invite = await prisma.inviteCode.create({
            data: {
                code,
                createdById: user.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
        });

        return NextResponse.json(invite);
    } catch (error) {
        console.error("Error creating invite:", error);
        return NextResponse.json({ error: "Error al crear invitación" }, { status: 500 });
    }
}

// DELETE: Delete an invite code
export async function DELETE(request: Request) {
    try {
        const user = await checkAdmin();

        if (!user) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        if (!user.isAdmin) {
            return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
        }

        const { id } = await request.json();

        await prisma.inviteCode.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting invite:", error);
        return NextResponse.json({ error: "Error al eliminar invitación" }, { status: 500 });
    }
}
