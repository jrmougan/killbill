import { prisma } from "@/lib/db";
import { getUserGroups } from "@/lib/membership";
import { getGroupBalances } from "@/lib/ledger-read";
import { normalizeCents } from "@/lib/home-format";
import type { MembershipRole, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Read-only cross-space summary for Inicio (carousel) and Espacios (list): one
 * row per space the user is an ACTIVE member of, with the caller's own net
 * balance (ledger — same source as the rest of the app, never recomputed here),
 * the other members' names and this month's shared spend.
 *
 * Authorization: only spaces from the caller's own ACTIVE memberships are ever
 * read, so nothing leaks across spaces.
 */
export type SpaceSummary = {
    id: string;
    name: string | null;
    type: SpaceType;
    status: SpaceStatus;
    role: MembershipRole;
    memberCount: number;
    expiresAt: Date | null;
    /** Other ACTIVE members' names, in join order. */
    others: string[];
    /** Caller's net balance in cents (+ owed to me, − I owe). */
    balanceCents: number;
    /** SHARED spend since `monthStart`, in cents. */
    monthTotalCents: number;
};

export async function getSpaceSummaries(userId: string, monthStart: Date): Promise<SpaceSummary[]> {
    const groups = await getUserGroups(userId);
    if (groups.length === 0) return [];
    const ids = groups.map((g) => g.id);

    const [roster, monthTotals, balances] = await Promise.all([
        prisma.membership.findMany({
            where: { groupId: { in: ids }, status: "ACTIVE", userId: { not: userId } },
            orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
            select: { groupId: true, user: { select: { name: true } } },
        }),
        prisma.expense.groupBy({
            by: ["coupleId"],
            where: { coupleId: { in: ids }, visibility: "SHARED", date: { gte: monthStart } },
            _sum: { amount: true },
        }),
        Promise.all(ids.map((id) => getGroupBalances(id))),
    ]);

    return groups.map((g, i) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        status: g.status,
        role: g.role,
        memberCount: g.memberCount,
        expiresAt: g.expiresAt,
        others: roster.filter((r) => r.groupId === g.id).map((r) => r.user.name),
        balanceCents: normalizeCents(balances[i][userId] ?? 0),
        monthTotalCents: monthTotals.find((t) => t.coupleId === g.id)?._sum.amount ?? 0,
    }));
}

/** The caller's PERSONAL (INDIVIDUAL mode) spend since `monthStart`, in cents. */
export async function getPersonalMonthTotal(userId: string, monthStart: Date): Promise<number> {
    const agg = await prisma.expense.aggregate({
        where: { ownerId: userId, visibility: "PERSONAL", date: { gte: monthStart } },
        _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
}
