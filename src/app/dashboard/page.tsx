import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { InviteCard } from "@/components/dashboard/invite-card";
import { JoinGroupCard } from "@/components/dashboard/join-group-card";
import { Expense } from "@/types";
import { Plus, GripHorizontal, Heart, Settings } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { calculateBalances, getLastSettlementDate } from "@/lib/finance";
import { toEuros } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { VisualBalanceLazy } from "@/components/ui/visual-balance-lazy";
import { PendingSettlements } from "@/components/dashboard/pending-settlements";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

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
                        <p className="text-sm text-muted-foreground">¡Bienvenido a EQUIL!</p>
                    </div>
                    <Link href="/settings">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                            <Settings className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </Link>
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

    // Balance is in CENTS, convert to euros for display
    let myBalanceCents = balances[userId] || 0;
    if (Math.abs(myBalanceCents) < 1) myBalanceCents = 0; // Less than 1 cent = 0
    const myBalance = toEuros(myBalanceCents);

    // Filter settlements pending for ME to confirm
    const myPendingSettlements = settlements
        .filter(s => s.toUserId === userId && s.status === "PENDING")
        .map(s => ({
            id: s.id,
            amount: s.amount,
            fromUser: {
                name: members.find(m => m.id === s.fromUserId)?.name || "Alguien",
                avatar: members.find(m => m.id === s.fromUserId)?.avatar || null
            },
            date: s.date.toISOString(),
            method: s.method
        }));

    // Calculate last settlement date for filtering
    const lastSettlementDate = getLastSettlementDate(settlements);

    // Combined recent items for display (unified view) - convert cents to euros
    const combinedRecent = [
        ...allExpenses.map(e => ({
            id: e.id,
            type: "EXPENSE" as const,
            description: e.description,
            amount: toEuros(e.amount), // cents -> euros
            date: e.date.toISOString(),
            category: e.category,
            paidBy: e.paidById,
            receiptUrl: e.receiptUrl,
            splits: e.splits.map(s => ({ userId: s.userId, amount: toEuros(s.amount) })),
        })),
        ...settlements.map((s: any) => ({
            id: s.id,
            type: "SETTLEMENT" as const,
            description: `Liquidación`,
            amount: toEuros(s.amount), // cents -> euros
            date: s.date.toISOString(),
            category: "settlement",
            paidBy: s.fromUserId,
            toUserId: s.toUserId,
            method: s.method,
            status: s.status
        }))
    ].filter(i => {
        if (i.type === "EXPENSE") return new Date(i.date) > lastSettlementDate;
        return i.type === "SETTLEMENT" && i.status === "PENDING";
    })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 10);

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
                    <Link href="/settings">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                            <Settings className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </Link>
                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-primary to-purple-500 p-[2px]">
                        <div className="h-full w-full rounded-full bg-black flex items-center justify-center font-bold text-xs overflow-hidden">
                            {user.avatar || "👤"}
                        </div>
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-1 gap-4">
                <GlassCard className={cn(
                    "p-0 flex flex-col items-center justify-center text-center overflow-hidden border-b-4",
                    !partner ? "border-pink-500/50 bg-pink-500/5" :
                        myBalance > 0 ? "border-emerald-500 bg-emerald-500/5 shadow-[inset_0_0_50px_rgba(16,185,129,0.1)]" :
                            myBalance < 0 ? "border-primary bg-primary/5 shadow-[inset_0_0_50px_rgba(236,72,153,0.1)]" : "border-white/10 bg-white/5"
                )}>
                    {!partner ? (
                        <div className="p-6">
                            <span className="text-xs uppercase font-bold tracking-[0.2em] text-muted-foreground mb-1">Tu Balance</span>
                            <h2 className="text-3xl font-bold text-pink-400">Esperando...</h2>
                            <p className="text-sm text-muted-foreground mt-2">
                                Invita a tu pareja para empezar a registrar gastos juntos
                            </p>
                        </div>
                    ) : (
                        <div className="w-full">
                            <div className="pt-6 px-6">
                                <span className="text-xs uppercase font-bold tracking-[0.2em] text-muted-foreground">Tu Balance</span>
                                <h2 className={cn(
                                    "text-4xl font-mono font-bold mt-1",
                                    myBalance > 0 ? "text-emerald-400" : myBalance < 0 ? "text-primary" : "text-white"
                                )}>
                                    {myBalance > 0 ? "+" : ""}{myBalance.toFixed(2)}€
                                </h2>
                            </div>

                            <VisualBalanceLazy
                                balance={myBalance}
                                user1={{ name: "Tú", avatar: user.avatar }}
                                user2={{ name: partner.name, avatar: partner.avatar }}
                                className="py-4"
                            />

                            <div className="pb-6 px-6">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {myBalance > 0 ? `Te deben ${myBalance.toFixed(2)}€` :
                                        myBalance < 0 ? `Debes ${Math.abs(myBalance).toFixed(2)}€` : "En equilibrio"}
                                </p>
                            </div>
                        </div>
                    )}
                </GlassCard>
            </section>

            {myPendingSettlements.length > 0 && (
                <PendingSettlements settlements={myPendingSettlements} />
            )}

            {/* Dashboard Actions */}
            <div className="flex gap-2">
                <Link href="/settle" className="flex-1">
                    <Button className="w-full bg-white/5 hover:bg-white/10 text-white border-white/10" variant="ghost">
                        <Plus className="mr-2 h-4 w-4" />
                        Liquidar Deuda
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

                    const totalThisMonth = toEuros(thisMonthExpenses.reduce((sum, e) => sum + e.amount, 0));
                    const totalLastMonth = toEuros(lastMonthExpenses.reduce((sum, e) => sum + e.amount, 0));

                    const categoryTotals = thisMonthExpenses.reduce<Record<string, number>>((acc, e) => {
                        acc[e.category] = (acc[e.category] || 0) + toEuros(e.amount);
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
                                    <p className="text-lg font-bold font-mono">{totalThisMonth.toFixed(2)}€</p>
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
                    <h2 className="text-lg font-semibold">Recientes (Pendientes)</h2>
                    {(allExpenses.length > 0 || settlements.length > 0) && (
                        <Link href="/expenses/list" className="text-sm text-primary hover:underline">
                            Ver todos →
                        </Link>
                    )}
                </div>

                <div className="space-y-3">
                    {combinedRecent.length === 0 ? (
                        (allExpenses.length > 0 || settlements.length > 0) ? (
                            <div className="text-center py-8 space-y-2 opacity-70">
                                <div className="text-4xl">✨</div>
                                <p className="font-bold text-sm">¡Todo al día!</p>
                                <p className="text-xs text-muted-foreground">No tienes pagos pendientes.</p>
                                <Link href="/expenses/list">
                                    <Button variant="ghost" size="sm" className="text-xs h-auto p-0 text-primary hover:bg-transparent hover:underline">
                                        Ver historial completo
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center py-12 space-y-4">
                                <div className="text-6xl animate-bounce">{partner ? "💸" : "💕"}</div>
                                <div className="space-y-1">
                                    <p className="font-bold text-lg">{partner ? "¡Sin movimientos aún!" : "¡Casi listos!"}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {partner
                                            ? <>Pulsa el botón <span className="text-primary font-bold">+</span> para añadir vuestro primer gasto</>
                                            : "Comparte el enlace de arriba para que tu pareja se una"
                                        }
                                    </p>
                                </div>
                            </div>
                        )
                    ) : (
                        combinedRecent.map((item) => {
                            if (item.type === "EXPENSE") {
                                return (
                                    <ExpenseCard
                                        key={item.id}
                                        expense={item as any}
                                        paidByUser={usersMap[item.paidBy]}
                                        allUsers={usersMap}
                                    />
                                );
                            } else {
                                const fromUser = usersMap[item.paidBy];
                                const toUser = item.toUserId ? usersMap[item.toUserId] : null;

                                return (
                                    <Link href={`/settle/${item.id}`} key={item.id}>
                                        <GlassCard className="p-4 flex items-center justify-between border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 transition-all border-l-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-xl">
                                                    🤝
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-sm">Liquidación</h3>
                                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                                        {fromUser?.name} → {toUser?.name}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        {new Date(item.date).toLocaleDateString()} • {item.method}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-lg font-mono font-bold text-blue-400">
                                                    {item.amount.toFixed(2)}€
                                                </p>
                                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                                    {item.status}
                                                </span>
                                            </div>
                                        </GlassCard>
                                    </Link>
                                );
                            }
                        })
                    )}
                </div>
            </section>

            {partner ? (
                <div className="fixed bottom-6 right-6 z-50">
                    <Link href="/expenses/new">
                        <Button size="icon" className="h-14 w-14 rounded-full shadow-2xl shadow-primary/50 bg-primary hover:bg-primary/90">
                            <Plus className="h-6 w-6" />
                        </Button>
                    </Link>
                </div>
            ) : (
                <div className="fixed bottom-6 right-6 z-50">
                    <Button size="icon" className="h-14 w-14 rounded-full shadow-xl bg-white/10 cursor-not-allowed opacity-50" disabled>
                        <Plus className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div>
    );
}
