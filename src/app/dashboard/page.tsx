import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { InviteCard } from "@/components/dashboard/invite-card";
import { JoinGroupCard } from "@/components/dashboard/join-group-card";
import { Expense, User } from "@/types";
import { Plus, GripHorizontal } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { calculateBalances } from "@/lib/finance";

export const dynamic = 'force-dynamic';

// Next.js 16: searchParams is a Promise
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const { code: inviteCode } = await searchParams;

    // Handle Invite / Group Switch BEFORE fetching user for render
    if (inviteCode && userId) {
        // Wait, simple prisma call
        const invitedGroup = await prisma.group.findUnique({ where: { code: inviteCode } });

        if (invitedGroup) {
            // Check current group
            const currentUser = await prisma.user.findUnique({ where: { id: userId } });
            if (currentUser && currentUser.groupId !== invitedGroup.id) {
                await prisma.user.update({
                    where: { id: userId },
                    data: { groupId: invitedGroup.id }
                });
            }
        }
    }

    // Fetch User & Group (will get the new group if updated)
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { group: { include: { users: true } } }
    });

    if (!user) {
        return <div className="p-10 text-center">User not found. <Link href="/login" className="underline">Login again</Link></div>;
    }

    if (!user.group) {
        return <div className="p-10 text-center">No group found. <Link href="/login" className="underline">Login again</Link></div>;
    }

    const members = user.group.users;
    // Explicitly type accumulator and current value
    const usersMap = members.reduce<Record<string, any>>((acc, u) => ({ ...acc, [u.id]: u }), {});

    // Fetch Expenses
    const rawExpenses = await prisma.expense.findMany({
        where: { groupId: user.groupId! },
        orderBy: { date: 'desc' },
        include: { splits: true }, // Include splits
        take: 20,
    });

    // Fetch Settlements
    const settlements = await prisma.settlement.findMany({
        where: { groupId: user.groupId! },
    });

    // Calculate Balances
    const balances = calculateBalances(
        members,
        rawExpenses.map(e => ({ paidById: e.paidById, amount: e.amount, splits: e.splits })),
        settlements,
        userId
    );

    const myBalance = balances[userId] || 0;

    const expenses: Expense[] = rawExpenses.map((e: any) => ({
        id: e.id,
        description: e.description,
        amount: e.amount,
        category: e.category as any,
        date: e.date.toISOString(),
        paidBy: e.paidById,
        splits: e.splits.map((s: any) => ({ userId: s.userId, amount: s.amount })), // Map to simple type
    }));

    return (
        <div className="flex flex-col h-full min-h-screen p-4 pb-24 space-y-6 relative">
            <header className="flex justify-between items-center pt-2">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                        Hola, {user.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {user.group.type === "COUPLE" ? "Pareja" : `Grupo: ${user.group.name}`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <LogoutButton />
                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-primary to-purple-500 p-[2px]">
                        <div className="h-full w-full rounded-full bg-black flex items-center justify-center font-bold text-xs overflow-hidden">
                            {user.avatar || "👤"}
                        </div>
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-2 gap-3">
                <GlassCard className="bg-primary/10 border-primary/20">
                    <span className="text-xs text-primary/80 uppercase font-bold tracking-wider">Debes</span>
                    <p className="text-2xl font-bold text-primary mt-1">
                        {myBalance < 0 ? Math.abs(myBalance).toFixed(2) : "0.00"}€
                    </p>
                </GlassCard>
                <GlassCard className="bg-emerald-500/10 border-emerald-500/20">
                    <span className="text-xs text-emerald-400 uppercase font-bold tracking-wider">Te Deben</span>
                    <p className="text-2xl font-bold text-emerald-400 mt-1">
                        {myBalance > 0 ? myBalance.toFixed(2) : "0.00"}€
                    </p>
                </GlassCard>
            </section>

            <div className="flex gap-2">
                <Link href="/settle" className="flex-1">
                    <Button className="w-full" variant="ghost">
                        <GripHorizontal className="mr-2 h-4 w-4" />
                        Liquidar Deuda
                    </Button>
                </Link>
            </div>

            <InviteCard code={user.group.code} />
            <JoinGroupCard />

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Recientes</h2>
                </div>

                <div className="space-y-3">
                    {expenses.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8 opacity-50">
                            No hay gastos aún.
                        </div>
                    ) : expenses.map((expense) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            paidByUser={usersMap[expense.paidBy]}
                        />
                    ))}
                </div>
            </section>

            <div className="fixed bottom-6 right-6 z-50">
                <Link href="/expenses/new">
                    <Button size="icon" className="h-14 w-14 rounded-full shadow-2xl shadow-primary/50 bg-primary hover:bg-primary/90">
                        <Plus className="h-6 w-6" />
                    </Button>
                </Link>
            </div>
        </div>
    );
}
