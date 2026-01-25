import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { InviteCard } from "@/components/dashboard/invite-card";
import { JoinGroupCard } from "@/components/dashboard/join-group-card";
import { Expense } from "@/types";
import { Plus, GripHorizontal, Users, Heart } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { calculateBalances } from "@/lib/finance";
import { GroupSelector } from "@/components/dashboard/group-selector";

export const dynamic = 'force-dynamic';

// Next.js 16: searchParams is a Promise
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const { code: inviteCode } = await searchParams;

    // Handle Invite Code - Join group and set as active
    if (inviteCode) {
        const invitedGroup = await prisma.group.findUnique({ where: { code: inviteCode } });

        if (invitedGroup) {
            // Check if already a member
            const existingMembership = await prisma.userGroup.findUnique({
                where: { userId_groupId: { userId, groupId: invitedGroup.id } },
            });

            if (!existingMembership) {
                await prisma.userGroup.create({
                    data: { userId, groupId: invitedGroup.id, role: "MEMBER" },
                });
            }

            // Set as active
            await prisma.user.update({
                where: { id: userId },
                data: { activeGroupId: invitedGroup.id },
            });

            // Redirect to clean URL
            redirect("/dashboard");
        }
    }

    // Fetch User with activeGroup and all groups
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            activeGroup: {
                include: {
                    members: {
                        include: { user: true },
                    },
                },
            },
            groups: {
                include: { group: true },
            },
        },
    });

    if (!user) {
        return <div className="p-10 text-center">User not found. <Link href="/login" className="underline">Login again</Link></div>;
    }

    const allGroups = user.groups.map(ug => ug.group);

    // No active group - show onboarding
    if (!user.activeGroup) {
        return (
            <div className="flex flex-col h-full min-h-screen p-4 space-y-6">
                <header className="flex justify-between items-center pt-2">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                            Hola, {user.name}
                        </h1>
                        <p className="text-sm text-muted-foreground">¡Bienvenido a Kill Bill!</p>
                    </div>
                    <LogoutButton />
                </header>

                <GlassCard className="text-center py-10 space-y-6">
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold">¿Cómo quieres empezar?</h2>
                        <p className="text-muted-foreground text-sm">
                            Crea un grupo para compartir gastos con amigos o una pareja para gestionar los gastos entre los dos.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Link href="/groups/new?type=GROUP">
                            <GlassCard className="cursor-pointer hover:bg-white/10 transition-all py-6 flex flex-col items-center gap-2">
                                <Users className="h-8 w-8 text-primary" />
                                <span className="font-bold">Crear Grupo</span>
                                <span className="text-xs text-muted-foreground">Para amigos, piso, viajes...</span>
                            </GlassCard>
                        </Link>
                        <Link href="/groups/new?type=COUPLE">
                            <GlassCard className="cursor-pointer hover:bg-white/10 transition-all py-6 flex flex-col items-center gap-2">
                                <Heart className="h-8 w-8 text-pink-500" />
                                <span className="font-bold">Crear Pareja</span>
                                <span className="text-xs text-muted-foreground">Gastos compartidos de pareja</span>
                            </GlassCard>
                        </Link>
                    </div>

                    <div className="pt-4">
                        <JoinGroupCard />
                    </div>
                </GlassCard>
            </div>
        );
    }

    // Active group exists - show normal dashboard
    const activeGroup = user.activeGroup;
    const members = activeGroup.members.map(m => m.user);
    const usersMap = members.reduce<Record<string, any>>((acc, u) => ({ ...acc, [u.id]: u }), {});

    // Fetch Expenses for active group
    const rawExpenses = await prisma.expense.findMany({
        where: { groupId: activeGroup.id },
        orderBy: { date: 'desc' },
        include: { splits: true },
        take: 20,
    });

    // Fetch Settlements
    const settlements = await prisma.settlement.findMany({
        where: { groupId: activeGroup.id },
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
        splits: e.splits.map((s: any) => ({ userId: s.userId, amount: s.amount })),
    }));

    return (
        <div className="flex flex-col h-full min-h-screen p-4 pb-24 space-y-6 relative">
            <header className="flex justify-between items-center pt-2">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                        Hola, {user.name}
                    </h1>
                    <GroupSelector
                        currentGroup={activeGroup}
                        allGroups={allGroups}
                    />
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

            <InviteCard code={activeGroup.code} />

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
