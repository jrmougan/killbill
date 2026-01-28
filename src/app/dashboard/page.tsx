import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { InviteCard } from "@/components/dashboard/invite-card";
import { JoinGroupCard } from "@/components/dashboard/join-group-card";
import { Expense } from "@/types";
import { Plus, GripHorizontal, Heart } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { calculateBalances } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    // Fetch User with couple and partner
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true,
                },
            },
        },
    });

    if (!user) {
        return <div className="p-10 text-center">Usuario no encontrado. <Link href="/login" className="underline">Login de nuevo</Link></div>;
    }

    // No couple - show onboarding
    if (!user.couple) {
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
                        <Heart className="h-16 w-16 text-pink-500 mx-auto animate-pulse" />
                        <h2 className="text-2xl font-bold">Empieza con tu pareja</h2>
                        <p className="text-muted-foreground text-sm max-w-[280px] mx-auto">
                            Gestiona vuestros gastos compartidos, viajes y ahorros en un solo lugar.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 px-4">
                        <form action={async () => {
                            'use server';
                            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                            await prisma.couple.create({
                                data: {
                                    name: "Nuestra Pareja",
                                    code,
                                    members: { connect: { id: userId } }
                                }
                            });
                            redirect("/dashboard");
                        }}>
                            <Button type="submit" size="lg" className="w-full h-16 text-lg font-bold">
                                Crear Pareja <Heart className="ml-2 h-5 w-5 fill-current" />
                            </Button>
                        </form>
                    </div>

                    <div className="pt-4 px-4">
                        <div className="relative mb-6">
                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/10"></span></div>
                            <div className="relative flex justify-center text-xs uppercase"><span className="bg-black px-2 text-muted-foreground">O únete a una</span></div>
                        </div>
                        <JoinGroupCard />
                    </div>
                </GlassCard>
            </div>
        );
    }

    // Couple exists - show normal dashboard
    const couple = user.couple;
    const members = couple.members;
    const partner = members.find(m => m.id !== userId);
    const usersMap = members.reduce<Record<string, any>>((acc, u) => ({ ...acc, [u.id]: u }), {});

    // Fetch ALL Expenses for balance calculation
    const allExpenses = await prisma.expense.findMany({
        where: { coupleId: couple.id },
        include: { splits: true },
    });

    // Get only recent for display
    const rawExpenses = allExpenses
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 20);

    // Fetch Settlements
    const settlements = await prisma.settlement.findMany({
        where: { coupleId: couple.id },
    });

    // Calculate Balances using ALL expenses
    const balances = calculateBalances(
        members,
        allExpenses.map(e => ({ paidById: e.paidById, amount: e.amount, splits: e.splits })),
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
        receiptUrl: e.receiptUrl,
        splits: e.splits.map((s: any) => ({ userId: s.userId, amount: s.amount })),
    }));

    return (
        <div className="flex flex-col h-full min-h-screen p-4 pb-24 space-y-6 relative">
            <header className="flex justify-between items-center pt-2">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                        Hola, {user.name}
                    </h1>
                    <div className="flex items-center gap-1 text-muted-foreground text-sm">
                        <Heart className="h-3 w-3 text-pink-500 fill-pink-500" />
                        <span>{partner ? `Pareja con ${partner.name}` : "Esperando a tu pareja..."}</span>
                    </div>
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

            <section className="grid grid-cols-1 gap-4">
                <GlassCard className={cn(
                    "p-6 flex flex-col items-center justify-center text-center border-b-4",
                    myBalance > 0 ? "border-emerald-500 bg-emerald-500/5" :
                        myBalance < 0 ? "border-primary bg-primary/5" : "border-white/10 bg-white/5"
                )}>
                    <span className="text-xs uppercase font-bold tracking-[0.2em] text-muted-foreground mb-1">Tu Balance</span>
                    <h2 className={cn(
                        "text-5xl font-mono font-bold",
                        myBalance > 0 ? "text-emerald-400" : myBalance < 0 ? "text-primary" : "text-white"
                    )}>
                        {myBalance > 0 ? "+" : ""}{myBalance.toFixed(2)}€
                    </h2>
                    <p className="text-sm text-muted-foreground mt-2">
                        {myBalance > 0 ? `Te deben ${myBalance.toFixed(2)}€` :
                            myBalance < 0 ? `Debes ${Math.abs(myBalance).toFixed(2)}€` : "Estás al día"}
                    </p>
                </GlassCard>
            </section>

            <div className="grid grid-cols-2 gap-2">
                <Link href="/settle" className="flex-1">
                    <Button className="w-full bg-white/5 hover:bg-white/10 text-white border-white/10" variant="ghost">
                        <Plus className="mr-2 h-4 w-4" />
                        Liquidar
                    </Button>
                </Link>
                <Link href="/settle/history" className="flex-1">
                    <Button className="w-full bg-white/5 hover:bg-white/10 text-white border-white/10" variant="ghost">
                        <GripHorizontal className="mr-2 h-4 w-4" />
                        Historial
                    </Button>
                </Link>
            </div>

            <section className="space-y-4">
                <h2 className="text-lg font-semibold ml-1">Resumen del Mes</h2>
                {(() => {
                    const now = new Date();
                    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

                    const thisMonthExpenses = allExpenses.filter(e => new Date(e.date) >= startOfMonth);
                    const lastMonthExpenses = allExpenses.filter(e => {
                        const d = new Date(e.date);
                        return d >= startOfLastMonth && d <= endOfLastMonth;
                    });

                    const totalThisMonth = thisMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
                    const totalLastMonth = lastMonthExpenses.reduce((sum, e) => sum + e.amount, 0);

                    const categoryTotals = thisMonthExpenses.reduce<Record<string, number>>((acc, e) => {
                        acc[e.category] = (acc[e.category] || 0) + e.amount;
                        return acc;
                    }, {});
                    const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];

                    const categoryEmojis: Record<string, string> = {
                        food: "🍕", transport: "🚗", entertainment: "🎬", shopping: "🛍️",
                        bills: "📄", health: "💊", travel: "✈️", other: "📦"
                    };

                    const percentChange = totalLastMonth > 0
                        ? ((totalThisMonth - totalLastMonth) / totalLastMonth * 100).toFixed(0)
                        : null;

                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-2">
                                <GlassCard className="p-4 text-center">
                                    <span className="text-2xl mb-1 block">💰</span>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Este mes</p>
                                    <p className="text-lg font-bold font-mono">{totalThisMonth.toFixed(0)}€</p>
                                </GlassCard>
                                <GlassCard className="p-4 text-center">
                                    <span className="text-2xl mb-1 block">{topCategory ? categoryEmojis[topCategory[0]] || "📊" : "📊"}</span>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Top</p>
                                    <p className="text-lg font-bold capitalize">{topCategory ? topCategory[0] : "-"}</p>
                                </GlassCard>
                                <GlassCard className="p-4 text-center">
                                    <span className="text-2xl mb-1 block">{percentChange && Number(percentChange) > 0 ? "📈" : "📉"}</span>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wider">vs Anterior</p>
                                    <p className={cn(
                                        "text-lg font-bold font-mono",
                                        percentChange && Number(percentChange) > 0 ? "text-red-400" : "text-emerald-400"
                                    )}>
                                        {percentChange ? `${Number(percentChange) > 0 ? "+" : ""}${percentChange}%` : "-"}
                                    </p>
                                </GlassCard>
                            </div>

                            {/* Spending Breakdown Bar */}
                            {totalThisMonth > 0 && (
                                <GlassCard className="p-4 space-y-3">
                                    <div className="flex h-3 w-full rounded-full overflow-hidden bg-white/5">
                                        {Object.entries(categoryTotals)
                                            .sort((a, b) => b[1] - a[1])
                                            .map(([cat, amount], idx) => {
                                                const percentage = (amount / totalThisMonth) * 100;
                                                const colors = [
                                                    "bg-primary", "bg-purple-500", "bg-emerald-500",
                                                    "bg-orange-500", "bg-blue-500", "bg-pink-500", "bg-yellow-500"
                                                ];
                                                return (
                                                    <div
                                                        key={cat}
                                                        className={cn("h-full", colors[idx % colors.length])}
                                                        style={{ width: `${percentage}%` }}
                                                        title={`${cat}: ${amount}€`}
                                                    />
                                                );
                                            })}
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                                        {Object.entries(categoryTotals)
                                            .sort((a, b) => b[1] - a[1])
                                            .slice(0, 4)
                                            .map(([cat, amount], idx) => {
                                                const colors = [
                                                    "bg-primary", "bg-purple-500", "bg-emerald-500",
                                                    "bg-orange-500", "bg-blue-500", "bg-pink-500", "bg-yellow-500"
                                                ];
                                                return (
                                                    <div key={cat} className="flex items-center gap-1.5">
                                                        <div className={cn("h-2 w-2 rounded-full", colors[idx % colors.length])} />
                                                        <span className="text-[10px] uppercase font-bold text-muted-foreground">
                                                            {cat} ({((amount / totalThisMonth) * 100).toFixed(0)}%)
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </GlassCard>
                            )}
                        </div>
                    );
                })()}
            </section>

            {!partner && <InviteCard code={couple.code} />}

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Recientes</h2>
                    {expenses.length > 0 && (
                        <Link href="/expenses/list" className="text-sm text-primary hover:underline">
                            Ver todos →
                        </Link>
                    )}
                </div>

                <div className="space-y-3">
                    {expenses.length === 0 ? (
                        <div className="text-center py-12 space-y-4">
                            <div className="text-6xl animate-bounce">💸</div>
                            <div className="space-y-1">
                                <p className="font-bold text-lg">¡Sin gastos aún!</p>
                                <p className="text-sm text-muted-foreground">
                                    Pulsa el botón <span className="text-primary font-bold">+</span> para añadir vuestro primer gasto
                                </p>
                            </div>
                        </div>
                    ) : expenses.map((expense) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            paidByUser={usersMap[expense.paidBy]}
                            allUsers={usersMap}
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
