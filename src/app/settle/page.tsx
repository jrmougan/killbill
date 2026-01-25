import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMyDebts } from "@/lib/finance";
import { SettleClient } from "./client";

export const dynamic = 'force-dynamic';

export default async function SettlePage() {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { group: { include: { users: true } } }
    });

    if (!user || !user.group) {
        return redirect("/dashboard");
    }

    const { group } = user;
    const members = group.users;

    // Fetch Expenses
    const rawExpenses = await prisma.expense.findMany({
        where: { groupId: group.id },
        orderBy: { date: 'desc' },
    });

    // Fetch Settlements with detailed debts and payments
    const settlements = await prisma.settlement.findMany({
        where: { groupId: group.id },
        include: { debts: true, payments: true },
    });

    // Calculate My Debts (High Level)
    const myDebtsMap = getMyDebts(
        members,
        rawExpenses.map(e => ({ paidById: e.paidById, amount: e.amount })),
        settlements,
        userId
    );

    // Calculate Detail (Specific Expenses I can pay for)
    // 1. Map how much of each expense has been settled by ME
    const mySettledExpenses = new Map<string, number>();
    // 2. Map of Forbidden Pairs: DebtID -> Set<CreditID>
    const forbiddenPairs = new Map<string, Set<string>>();
    settlements.forEach(s => {
        // Collect debts and payments for pairwise constraint
        const expensePayments = s.payments.filter(p => p.type === 'EXPENSE' && p.expenseId).map(p => p.expenseId!);
        const debts = s.debts;

        if (expensePayments.length > 0) {
            debts.forEach(d => {
                if (!forbiddenPairs.has(d.expenseId)) {
                    forbiddenPairs.set(d.expenseId, new Set());
                }
                expensePayments.forEach(creditId => {
                    forbiddenPairs.get(d.expenseId)!.add(creditId);
                });
            });
        }

        // Direct Settlement: I paid via SettlementDebt
        if (s.fromUserId === userId) {
            s.debts.forEach(d => {
                mySettledExpenses.set(d.expenseId, (mySettledExpenses.get(d.expenseId) || 0) + d.amount);
            });
        }

        // Indirect Settlement: SOMEONE ELSE used an expense I OWE on as payment
        // (i.e. They paid me back by forgiving this debt)
        if (s.toUserId === userId) {
            s.payments.forEach(p => {
                if (p.expenseId && p.type === 'EXPENSE') {
                    // If I owe on this expense, and they used it as payment, it counts as me paying it back.
                    mySettledExpenses.set(p.expenseId, (mySettledExpenses.get(p.expenseId) || 0) + p.amount);
                }
            });
        }
    });

    const candidates = rawExpenses
        .filter(e => e.paidById !== userId) // Expenses I didn't pay (Debt Candidates)
        .map(e => {
            const myShare = e.amount / members.length;
            const settled = mySettledExpenses.get(e.id) || 0;
            const remaining = myShare - settled;
            return {
                id: e.id,
                description: e.description,
                amount: e.amount,
                date: e.date.toISOString(),
                paidById: e.paidById,
                status: e.status, // Pass Status
                myShare,
                remaining
            };
        })
        .filter(e => e.remaining > 0.01); // Only showing what I still owe

    // Calculate Credit Candidates (Expenses I PAID that haven't been fully reimbursed)
    // Constraint: Only unused expenses (Status = OPEN) can be used as credit (per user request)
    // "que no aparezcan los gastos que ya se han utilizado para liquidar otro gasto"

    const reimbursedAmountMap = new Map<string, number>();
    settlements.forEach(s => {
        if (s.toUserId === userId) {
            s.debts.forEach(d => {
                reimbursedAmountMap.set(d.expenseId, (reimbursedAmountMap.get(d.expenseId) || 0) + d.amount);
            });
        }
    });

    const creditCandidates = rawExpenses
        .filter(e => e.paidById === userId) // Expenses I PAID
        .filter(e => e.status === 'OPEN') // STRICT FILTER: Only OPEN expenses
        .map(e => {
            const myShare = e.amount / members.length;
            const totalToReimburse = e.amount - myShare;
            const reimbursed = reimbursedAmountMap.get(e.id) || 0;
            const remainingCredit = totalToReimburse - reimbursed;

            return {
                id: e.id,
                description: e.description,
                amount: e.amount,
                date: e.date.toISOString(),
                paidById: e.paidById,
                status: e.status,
                myShare,
                remaining: remainingCredit
            }
        })
        .filter(e => e.remaining > 0.01);


    // Format for client
    const debts = Object.entries(myDebtsMap).map(([targetId, amount]) => {
        const targetUser = members.find(u => u.id === targetId);
        return {
            userId: targetId,
            name: targetUser?.name || "Unknown",
            avatar: targetUser?.avatar || "👤",
            amount: amount
        };
    });

    // Convert Map to Object for serialization
    const forbiddenPairsObj: Record<string, string[]> = {};
    forbiddenPairs.forEach((v, k) => {
        forbiddenPairsObj[k] = Array.from(v);
    });

    return <SettleClient
        debts={debts}
        candidates={candidates}
        creditCandidates={creditCandidates}
        forbiddenPairs={forbiddenPairsObj}
    />;
}
