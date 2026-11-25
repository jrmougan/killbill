import { prisma } from "@/lib/db";
import { getUserGroups } from "@/lib/membership";
import { balancesForMembers, sumLedgerByGroup } from "@/lib/ledger-read";
import { normalizeCents } from "@/lib/home-format";
import type { MembershipRole, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Read-only cross-space summary for Inicio (carousel) and Espacios (list): one
 * row per space the user is an ACTIVE member of, with the caller's own net
 * balance (ledger — same source as the rest of the app, never recomputed here),
 * every member's balance, the other members' names and this month's shared spend.
 *
 * Authorization: only spaces from the caller's own ACTIVE memberships are ever
 * read, so nothing leaks across spaces.
 *
 * Month totals take a HALF-OPEN range `[start, end)` from `monthRange()`
 * (Europe/Madrid) so future-dated expenses never count as "este mes".
 */
export type MonthBounds = { start: Date; end: Date };

export type SpaceMemberBalance = {
    id: string;
    name: string;
    avatar: string | null;
    isGuest: boolean;
    /** Net balance in cents (+ is owed, − owes). */
    balanceCents: number;
};

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
    /** Every ACTIVE member (caller included) with their ledger balance, in join order. */
    members: SpaceMemberBalance[];
    /** Caller's net balance in cents (+ owed to me, − I owe). */
    balanceCents: number;
    /** SHARED spend within the month range, in cents. */
    monthTotalCents: number;
};

export async function getSpaceSummaries(userId: string, month: MonthBounds): Promise<SpaceSummary[]> {
    const groups = await getUserGroups(userId);
    if (groups.length === 0) return [];
    const ids = groups.map((g) => g.id);

    // Three queries for ALL spaces (roster, month totals, ledger sums) — the
    // ledger is aggregated in SQL once for every space, not once per space (M2).
    const [roster, monthTotals, nets] = await Promise.all([
        prisma.membership.findMany({
            where: { groupId: { in: ids }, status: "ACTIVE" },
            orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
            select: { groupId: true, userId: true, user: { select: { name: true, avatar: true, isGuest: true } } },
        }),
        prisma.expense.groupBy({
            by: ["coupleId"],
            where: { coupleId: { in: ids }, visibility: "SHARED", date: { gte: month.start, lt: month.end } },
            _sum: { amount: true },
        }),
        sumLedgerByGroup(ids),
    ]);

    return groups.map((g) => {
        const inGroup = roster.filter((r) => r.groupId === g.id);
        const balances = balancesForMembers(nets.get(g.id), inGroup.map((r) => r.userId));
        return {
            id: g.id,
            name: g.name,
            type: g.type,
            status: g.status,
            role: g.role,
            memberCount: g.memberCount,
            expiresAt: g.expiresAt,
            others: inGroup.filter((r) => r.userId !== userId).map((r) => r.user.name),
            members: inGroup.map((r) => ({
                id: r.userId,
                name: r.user.name,
                avatar: r.user.avatar ?? null,
                isGuest: r.user.isGuest,
                balanceCents: normalizeCents(balances[r.userId] ?? 0),
            })),
            balanceCents: normalizeCents(balances[userId] ?? 0),
            monthTotalCents: monthTotals.find((t) => t.coupleId === g.id)?._sum.amount ?? 0,
        };
    });
}

/** The caller's PERSONAL (INDIVIDUAL mode) spend within the month range, in cents. */
export async function getPersonalMonthTotal(userId: string, month: MonthBounds): Promise<number> {
    const agg = await prisma.expense.aggregate({
        where: { ownerId: userId, visibility: "PERSONAL", date: { gte: month.start, lt: month.end } },
        _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
}
