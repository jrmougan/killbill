import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { resolveMyDebts, getLastSettlementDate } from "@/lib/finance";
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

    // Find local cutoff date: only confirmed settlements mark a settled checkpoint.
    // Pending/rejected settlements do not advance the cutoff date.
    const confirmedSettlements = settlements.filter(s => s.status === "CONFIRMED");
    const lastSettlementDate = getLastSettlementDate(confirmedSettlements);

    // Fetch unsettled expenses where I owe money
    // Logic change: We show expenses since the last settlement, regardless of status (as status is deprecated)
    const unsettledExpenses = rawExpenses
        .filter(e => new Date(e.date) > lastSettlementDate && e.paidById !== userId)
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
        partner={partner ? {
            id: partner.id,
            name: partner.name,
            avatar: partner.avatar || "👤"
        } : null}
    />;
}
