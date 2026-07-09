import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

/**
 * Max ACTIVE members per group. Phase "decouple" F3: was a hard cap of 2
 * (couples-only); now a group (family) can hold several members. A sane upper
 * bound guards against abuse; the split/finance/ledger math is N-way already.
 */
export const MAX_GROUP_MEMBERS = 20;

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

/**
 * Resolves the user's primary group: the groupId of their single ACTIVE
 * membership (today the model is 1 user : 1 group, so "primary" == "only").
 *
 * This is the Phase 4 replacement for every SELECTOR read of `user.coupleId`
 * ("which group am I in?"). Writes keep dual-writing `User.coupleId` until the
 * gated column drop. Costs exactly one indexed query ([userId] index on
 * Membership); call it once per request handler and pass the id down.
 *
 * Deterministic if the 1:1 invariant is ever relaxed: oldest joinedAt wins,
 * groupId as tiebreak (mirrors getGroupMembers ordering discipline).
 */
export async function getPrimaryGroup(userId: string): Promise<string | null> {
    const membership = await prisma.membership.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: [{ joinedAt: "asc" }, { groupId: "asc" }],
        select: { groupId: true },
    });
    return membership?.groupId ?? null;
}

/** Fetch a single membership (for role/status checks). */
export function getMembership(groupId: string, userId: string) {
    return prisma.membership.findUnique({
        where: { groupId_userId: { groupId, userId } },
    });
}
