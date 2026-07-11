import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { resolveMyDebts } from "@/lib/finance";
import { getGroupBalances } from "@/lib/ledger-read";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { NoGroupState } from "@/components/ui/no-group-state";
import { calculateSplitAmounts } from "@/lib/splits";
import { toEuros } from "@/lib/currency";
import { categoryKeyOf, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { SettleClient } from "./client";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export default async function SettlePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    const isGuest = session.kind === "guest";

    // Phase 5 (WS1): resolve the group + members via the Membership layer.
    const groupId = await getActiveGroup(userId);
    if (!groupId) {
        return <NoGroupState title="Liquidar deudas" />;
    }

    const members = await getGroupMembers(groupId);

    // Fetch shared expenses for couple with splits (personal expenses never affect debts).
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: groupId, visibility: "SHARED" },
        include: { splits: true, ...CATEGORY_REF_SELECT },
    });

    // Fetch Settlements for couple
    const settlements = await prisma.settlement.findMany({
        where: { coupleId: groupId },
    });

    // Debts resolve from ledger-sourced balances (proven == calculateBalances by
    // reconcile-ledger.ts). resolveMyDebts is the same greedy matching algorithm,
    // now fed the ledger balances instead of a fresh calculateBalances pass.
    const balances = await getGroupBalances(groupId);
    const myDebtsMap = resolveMyDebts(balances, userId);

    // Format for client - convert cents to euros
    const debts = Object.entries(myDebtsMap).map(([targetId, amountCents]) => {
        const targetUser = members.find(u => u.id === targetId);
        return {
            userId: targetId,
            name: targetUser?.name || "Unknown",
            avatar: targetUser?.avatar || "👤",
            amount: toEuros(amountCents) // Convert to euros for display
        };
    });

    // Pairwise cutoff (Fase 1 fix): a single GLOBAL last-settlement date was wrong
    // in a group — settling with member A wrongly hid unpaid expenses paid by
    // member B. Compute, per counterparty, the last CONFIRMED settlement date
    // between me and them (either direction); that is THAT pair's settled
    // checkpoint. An expense is "unsettled" only against its own payer's cutoff.
    const pairwiseCutoff = new Map<string, Date>();
    for (const s of settlements) {
        if (s.status !== "CONFIRMED") continue;
        const other = s.fromUserId === userId ? s.toUserId
            : s.toUserId === userId ? s.fromUserId
                : null;
        if (!other) continue;
        const d = new Date(s.date);
        const prev = pairwiseCutoff.get(other);
        if (!prev || d > prev) pairwiseCutoff.set(other, d);
    }

    // Fetch unsettled expenses where I owe money (paid by someone else, and dated
    // after my pairwise checkpoint with that payer).
    const unsettledExpenses = rawExpenses
        .filter(e => {
            if (e.paidById === userId) return false;
            const cutoff = pairwiseCutoff.get(e.paidById);
            return !cutoff || new Date(e.date) > cutoff;
        })
        .map(e => {
            // Find my split or 50%
            let myAmountCents = 0;
            if (e.splits.length > 0) {
                myAmountCents = e.splits.find(s => s.userId === userId)?.amount || 0;
            } else {
                // No Split rows: derive my share using the canonical remainder
                // allocation (leftover cent goes to the first member) so the
                // displayed share matches calculateBalances on odd-cent expenses.
                const computedSplits = calculateSplitAmounts(e.amount, null, members);
                myAmountCents = computedSplits.find(s => s.userId === userId)?.amount || 0;
            }
            return {
                id: e.id,
                description: e.description,
                amount: toEuros(e.amount), // Convert to euros
                myAmount: toEuros(myAmountCents), // Convert to euros
                date: e.date.toISOString(),
                category: categoryKeyOf(e),
                paidBy: e.paidById
            };
        })
        .filter(e => e.myAmount > 0)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const partner = members.find(m => m.id !== userId);

    return <SettleClient
        debts={debts}
        expenses={unsettledExpenses}
        isGuest={isGuest}
        partner={partner ? {
            id: partner.id,
            name: partner.name,
            avatar: partner.avatar || "👤"
        } : null}
    />;
}
