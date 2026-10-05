import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getGroupBalances } from "@/lib/ledger-read";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { calculateSplitAmounts } from "@/lib/splits";
import { spaceTypeMeta } from "@/lib/space-ui";
import { SpaceType } from "@/generated/prisma/enums";
import { buildTicket, myTransfers, ticketMeta, type TicketExpense } from "@/components/settle/settle-model";
import { SettleClient } from "./client";

export const dynamic = 'force-dynamic';

/**
 * "Quedar en paz" — settle the ACTIVE space.
 *
 * Money comes from the canonical sources only: my net balance and the suggested
 * pairwise transfers from the ledger balances (getGroupBalances +
 * resolveMyDebts). The receipt ticket summarises the SHARED expenses recorded
 * since my last CONFIRMED settlement in this space (or all of them if I never
 * settled) and reconciles anything else (previous debt, payments, backdated
 * expenses) into one explicit row, so the ticket always adds up to the balance.
 */
export default async function SettlePage() {
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    const userId = ctx.userId;
    const isGuest = ctx.kind === "guest";

    // Personal mode (no shared space) has nothing to settle.
    const groupId = await getActiveGroup(userId);
    if (!groupId) redirect("/dashboard");
    const auth = await requireSpaceAccess(ctx, groupId, { allowArchived: true, allowGuest: true });
    if (!auth.ok || auth.space.type === SpaceType.INDIVIDUAL) redirect("/dashboard");
    const space = auth.space;

    const [members, balances, settlements] = await Promise.all([
        getGroupMembers(groupId),
        getGroupBalances(groupId),
        prisma.settlement.findMany({
            where: { coupleId: groupId, OR: [{ fromUserId: userId }, { toUserId: userId }] },
            select: { id: true, fromUserId: true, toUserId: true, amount: true, method: true, status: true, date: true },
            orderBy: { date: "desc" },
        }),
    ]);

    const lastConfirmed = settlements.find((s) => s.status === "CONFIRMED")?.date ?? null;

    const rawExpenses = await prisma.expense.findMany({
        where: {
            coupleId: groupId,
            visibility: "SHARED",
            ...(lastConfirmed ? { createdAt: { gt: lastConfirmed } } : {}),
        },
        select: { amount: true, paidById: true, date: true, splits: { select: { userId: true, amount: true } } },
    });

    const n = members.length;
    const expenses: TicketExpense[] = rawExpenses.map((e) => {
        // Same share convention as finance.calculateBalances: split rows when
        // present, else the canonical equal split with remainder cents.
        const splits = e.splits.length > 0 ? e.splits : calculateSplitAmounts(e.amount, null, members);
        const amounts = splits.map((s) => s.amount);
        const equal = e.splits.length === 0
            || (splits.length === n && Math.max(...amounts) - Math.min(...amounts) <= 1);
        return {
            amount: e.amount,
            paidById: e.paidById,
            myShare: splits.find((s) => s.userId === userId)?.amount ?? 0,
            equal,
        };
    });

    const balance = balances[userId] ?? 0;
    const ticket = buildTicket(expenses, userId, balance);

    const firstExpense = rawExpenses.reduce<Date | null>((min, e) => (!min || e.date < min ? e.date : min), null);
    const periodStart = lastConfirmed ?? firstExpense;
    const meta = ticketMeta(periodStart, new Date(), ticket.count);

    const nameOf = new Map(members.map((m) => [m.id, m.name]));
    // A settlement can involve a member who already left: resolve their name too.
    const missing = settlements
        .flatMap((s) => [s.fromUserId, s.toUserId])
        .filter((id, i, all) => !nameOf.has(id) && all.indexOf(id) === i);
    if (missing.length > 0) {
        const users = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
        for (const u of users) nameOf.set(u.id, u.name);
    }

    return (
        <SettleClient
            space={{
                id: space.id,
                name: space.name ?? spaceTypeMeta(space.type).label,
                status: space.status,
            }}
            me={userId}
            isGuest={isGuest}
            memberCount={n}
            partnerId={n === 2 ? members.find((m) => m.id !== userId)?.id ?? null : null}
            names={Object.fromEntries(nameOf)}
            balance={balance}
            ticket={ticket}
            meta={meta}
            transfers={myTransfers(balances, userId)}
            pending={settlements
                .filter((s) => s.status === "PENDING" && s.amount > 0)
                .map((s) => ({
                    id: s.id,
                    fromUserId: s.fromUserId,
                    toUserId: s.toUserId,
                    amount: s.amount,
                    method: s.method,
                }))}
        />
    );
}
