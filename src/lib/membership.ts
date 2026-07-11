import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import type { User } from "@/generated/prisma/client";
import type { SpaceType, SpaceStatus, MembershipRole } from "@/generated/prisma/enums";

/** Cookie holding the user's currently-active group (multi-group support, F4). */
export const ACTIVE_GROUP_COOKIE = "active_group";

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

/**
 * All ACTIVE groups the user belongs to, in a stable order (for the group
 * switcher). Phase "decouple" F4: a user can be in several groups.
 */
export async function getUserGroups(
    userId: string
): Promise<{
    id: string;
    name: string | null;
    code: string;
    memberCount: number;
    type: SpaceType;
    status: SpaceStatus;
    role: MembershipRole;
    expiresAt: Date | null;
}[]> {
    const memberships = await prisma.membership.findMany({
        where: { userId, status: "ACTIVE" },
        orderBy: [{ joinedAt: "asc" }, { groupId: "asc" }],
        include: {
            group: {
                select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true,
                    status: true,
                    expiresAt: true,
                    // ACTIVE-only member count — mirrors getGroupMembers semantics.
                    _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
                },
            },
        },
    });
    return memberships.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        code: m.group.code,
        memberCount: m.group._count.memberships,
        type: m.group.type,
        status: m.group.status,
        role: m.role,
        expiresAt: m.group.expiresAt,
    }));
}

/**
 * Resolves the user's ACTIVE group: the one stored in the `active_group` cookie
 * (multi-group, F4) if the user actually belongs to it, else the primary (oldest)
 * group. This is the "which group am I operating in?" resolver — use it for all
 * reads/writes scoped to the current group. A tampered/stale cookie is ignored
 * (the membership check is the guard), so it can never point at a foreign group.
 */
export async function getActiveGroup(userId: string): Promise<string | null> {
    const cookieStore = await cookies();
    const active = cookieStore.get(ACTIVE_GROUP_COOKIE)?.value;
    if (active) {
        const m = await prisma.membership.findFirst({
            where: { userId, groupId: active, status: "ACTIVE" },
            select: { groupId: true },
        });
        if (m) return m.groupId;
    }
    return getPrimaryGroup(userId);
}

/** Fetch a single membership (for role/status checks). */
export function getMembership(groupId: string, userId: string) {
    return prisma.membership.findUnique({
        where: { groupId_userId: { groupId, userId } },
    });
}
