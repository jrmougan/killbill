import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

/**
 * Returns the ACTIVE members of a group (a.k.a. couple) via the Membership layer.
 *
 * Ordered by joinedAt asc, then userId asc — the backfill set joinedAt = User.createdAt,
 * so this reproduces the previous `couple.members` ordering. That ordering is
 * load-bearing: the deterministic remainder-cent allocation in finance.ts /
 * splits.ts depends on member order, so it must not drift.
 */
export async function getGroupMembers(groupId: string): Promise<User[]> {
    const memberships = await prisma.membership.findMany({
        where: { groupId, status: "ACTIVE" },
        include: { user: true },
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    });
    return memberships.map((m) => m.user);
}

/** Fetch a single membership (for role/status checks). */
export function getMembership(groupId: string, userId: string) {
    return prisma.membership.findUnique({
        where: { groupId_userId: { groupId, userId } },
    });
}
