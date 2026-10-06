import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getGroupBalances } from "@/lib/ledger-read";
import { getGroupMembers } from "@/lib/membership";
import { getSessionCtx } from "@/lib/authz";
import { calculateSplitAmounts } from "@/lib/splits";
import { spaceTypeMeta } from "@/lib/space-ui";
import { resolveSettleSpace } from "@/lib/settlement-space";
import {
    buildTicket,
    everyoneAtPeace,
    myTransfers,
    ticketMeta,
    ticketPeriod,
    type LedgerEvent,
    type TicketExpense,
} from "@/components/settle/settle-model";
import { SettleClient } from "./client";

export const dynamic = 'force-dynamic';

/**
 * "Quedar en paz" — settle a space: `?space=<groupId>` when given (authorized
 * against that space), else the active space.
 *
 * Money comes from the canonical sources only: my net balance and the suggested
 * pairwise transfers from the ledger balances (getGroupBalances +
 * resolveMyDebts). The receipt ticket summarises the SHARED expenses recorded
 * since my balance was last exactly 0 (a partial payment does not reset it, so
 * the ticket keeps explaining what is still owed), shows the confirmed payments
 * of that period as their own row, and reconciles anything else into one
 * explicit row, so the ticket always adds up to the balance.
 */
export default async function SettlePage({ searchParams }: { searchParams: Promise<{ space?: string | string[] }> }) {
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    const userId = ctx.userId;
    const isGuest = ctx.kind === "guest";

    const resolved = await resolveSettleSpace(ctx, (await searchParams).space);
    if (!resolved) redirect("/dashboard");
    const { groupId, auth } = resolved;
    const space = auth.space;

    const [members, balances, settlements, myEntries] = await Promise.all([
        getGroupMembers(groupId),
        getGroupBalances(groupId),
        prisma.settlement.findMany({
            where: { coupleId: groupId, status: "PENDING", amount: { gt: 0 }, OR: [{ fromUserId: userId }, { toUserId: userId }] },
            select: { id: true, fromUserId: true, toUserId: true, amount: true, method: true },
            orderBy: { date: "desc" },
        }),
        prisma.ledgerEntry.findMany({
            where: { account: { groupId, userId } },
            select: {
                amount: true,
                transaction: {
                    select: {
                        id: true,
                        kind: true,
                        createdAt: true,
                        expense: { select: { createdAt: true } },
                        settlement: { select: { updatedAt: true } },
                    },
                },
            },
        }),
    ]);

    // Replay my ledger movements in app order (expense creation / settlement
    // confirmation) to find when my balance was last 0.
    const events: LedgerEvent[] = myEntries.map((e) => ({
        amount: e.amount,
        kind: e.transaction.kind,
        key: e.transaction.id,
        at: e.transaction.expense?.createdAt ?? e.transaction.settlement?.updatedAt ?? e.transaction.createdAt,
    }));
    const period = ticketPeriod(events);

    const rawExpenses = await prisma.expense.findMany({
        where: {
            coupleId: groupId,
            visibility: "SHARED",
            ...(period.since ? { createdAt: { gt: period.since } } : {}),
        },
        select: { amount: true, paidById: true, date: true, splits: { select: { userId: true, amount: true } } },
    });

    const n = members.length;
    const expenses: TicketExpense[] = rawExpenses.map((e) => {
        // Same share convention as finance.calculateBalances: split rows when
        // present, else the canonical equal split with remainder cents.
        const splits = e.splits.length > 0 ? e.splits : calculateSplitAmounts(e.amount, null, members);
        const amounts = splits.map((s) => s.amount);
        // Identical shares only ("A cada uno" must be true for everybody).
        const equal = splits.length === n && Math.max(...amounts) === Math.min(...amounts);
        return {
            amount: e.amount,
            paidById: e.paidById,
            myShare: splits.find((s) => s.userId === userId)?.amount ?? 0,
            equal,
        };
    });

    const balance = balances[userId] ?? 0;
    const ticket = buildTicket(expenses, userId, balance, period.payments);

    const firstExpense = rawExpenses.reduce<Date | null>((min, e) => (!min || e.date < min ? e.date : min), null);
    const meta = ticketMeta(period.since ?? firstExpense, new Date(), ticket.count);

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
            everyoneSettled={everyoneAtPeace(balances)}
            ticket={ticket}
            meta={meta}
            transfers={myTransfers(balances, userId)}
            pending={settlements}
        />
    );
}
