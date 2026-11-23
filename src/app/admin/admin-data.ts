import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** A registration invite as the admin panel renders it (dates serialized). */
export interface AdminInvite {
    id: string;
    code: string;
    createdAt: string;
    usedAt: string | null;
    expiresAt: string | null;
    usedBy: { id: string; name: string; email: string | null } | null;
}

/**
 * The caller when it is an admin, re-checked against the DB (`User.isAdmin`),
 * never trusted from the JWT claim — the same rule as /api/admin/invites.
 * Only a regular browser session administers, the same rule as `auth: 'admin'`
 * in route(): guest sessions and MCP tokens are rejected even if the user is an admin.
 */
export type AdminCheck = { status: "ok"; userId: string } | { status: "unauthenticated" } | { status: "forbidden" };

export async function checkAdmin(): Promise<AdminCheck> {
    const session = await getSession();
    if (!session?.userId) return { status: "unauthenticated" };
    if (session.kind !== undefined) return { status: "forbidden" };
    const user = await prisma.user.findUnique({
        where: { id: session.userId as string },
        select: { id: true, isAdmin: true },
    });
    if (!user) return { status: "unauthenticated" };
    return user.isAdmin ? { status: "ok", userId: user.id } : { status: "forbidden" };
}

export async function listInvites(): Promise<AdminInvite[]> {
    const invites = await prisma.inviteCode.findMany({
        orderBy: { createdAt: "desc" },
        include: { usedBy: { select: { id: true, name: true, email: true } } },
    });
    return invites.map((i) => ({
        id: i.id,
        code: i.code,
        createdAt: i.createdAt.toISOString(),
        usedAt: i.usedAt?.toISOString() ?? null,
        expiresAt: i.expiresAt?.toISOString() ?? null,
        usedBy: i.usedBy,
    }));
}

/** Random 8-character code, valid for 7 days. Shared by the admin panel and POST /api/admin/invites. */
export async function createInviteFor(adminId: string) {
    return prisma.inviteCode.create({
        data: {
            code: randomBytes(4).toString("hex").toUpperCase(),
            createdById: adminId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
    });
}

/**
 * Void an invite that nobody has used yet; returns whether a row was deleted.
 * The `usedById: null` guard is the point: a code consumed while the admin had
 * the confirmation open stays as the "Usadas" record of who registered with it.
 * Shared by the admin panel and DELETE /api/admin/invites.
 */
export async function deleteInvite(id: string): Promise<boolean> {
    const { count } = await prisma.inviteCode.deleteMany({ where: { id, usedById: null } });
    return count > 0;
}
