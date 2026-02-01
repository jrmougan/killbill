import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getMyDebts } from "@/lib/finance";
import { EditSettleClient } from "./client";

export const dynamic = 'force-dynamic';

interface EditSettlePageProps {
    params: { id: string };
}

export default async function EditSettlePage({ params }: EditSettlePageProps) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: {
            fromUser: true,
            toUser: true,
            expenses: {
                include: { splits: true }
            }
        }
    });

    if (!settlement) notFound();
    if (settlement.fromUserId !== userId) redirect(`/settle/${id}`);

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!user || !user.couple) redirect("/dashboard");
    const members = user.couple.members;

    // Fetch Expenses for couple with splits
    const rawExpenses = await prisma.expense.findMany({
        where: { coupleId: user.coupleId as string },
        include: { splits: true },
    });

    // Expenses that can be part of this settlement:
    // 1. Those that are ALREADY in this settlement
    // 2. Those that are OPEN and paid by someone else
    const relevantExpenses = rawExpenses
        .filter(e => {
            if (e.settlementId === id) return true;
            return e.status === "OPEN" && e.paidById !== userId;
        })
        .map(e => {
            let myAmount = 0;
            if (e.splits.length > 0) {
                myAmount = e.splits.find(s => s.userId === userId)?.amount || 0;
            } else {
                myAmount = e.amount / members.length;
            }
            return {
                id: e.id,
                description: e.description,
                amount: e.amount,
                myAmount,
                date: e.date.toISOString(),
                category: e.category,
                paidBy: e.paidById
            };
        })
        .filter(e => e.myAmount > 0);

    const initialExpenseIds = settlement.expenses.map(e => e.id);

    return (
        <EditSettleClient
            settlementId={id}
            expenses={relevantExpenses}
            initialExpenseIds={initialExpenseIds}
            initialMethod={settlement.method as any}
            toUser={{
                id: settlement.toUserId,
                name: settlement.toUser.name,
                avatar: settlement.toUser.avatar || "👤"
            }}
        />
    );
}
