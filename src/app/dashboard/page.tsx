import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { User, Expense } from "@/types";
import { InviteCard } from "@/components/dashboard/invite-card";
import { JoinGroupCard } from "@/components/dashboard/join-group-card";
import { Plus, Heart, Settings, BarChart2, ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { calculateBalances, getLastSettlementDate } from "@/lib/finance";
import { materializeDueRecurringExpenses } from "@/lib/recurring";
import { toEuros, formatEuros } from "@/lib/currency";
import { getCategoryById } from "@/lib/categories";
import { getSettlementStatusLabel, getSettlementMethodLabel } from "@/lib/settlement-labels";
import { cn } from "@/lib/utils";
import { isAvatarUrl } from "@/lib/avatar";
import { VisualBalanceLazy } from "@/components/ui/visual-balance-lazy";
import { PendingSettlements } from "@/components/dashboard/pending-settlements";
import { randomBytes } from "crypto";

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
                        <h1 className="text-[23px] font-bold tracking-[-0.02em] text-foreground">
                            Hola, {user.name}
                        </h1>
                        <p className="text-[13px] text-muted-foreground mt-1">¡Bienvenido a EQUIL!</p>
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
                            const code = randomBytes(3).toString('hex').toUpperCase();
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
    const usersMap = members.reduce<Record<string, User>>((acc, u) => ({ ...acc, [u.id]: u }), {});

    // Lazily materialize any due recurring expenses so they show up automatically.
    // A failure here must never block the dashboard render.
    try {
        await materializeDueRecurringExpenses(couple.id);
    } catch (err) {
        console.error("Failed to materialize recurring expenses", err);
    }

    // Fetch ALL Expenses for balance calculation
    const allExpenses = await prisma.expense.findMany({
        where: { coupleId: couple.id },
        include: { splits: true },
    });

    // Fetch Settlements
    const settlements = await prisma.settlement.findMany({
        where: { coupleId: couple.id },
    });

    // Only confirmed settlements count towards the balance.
    // Pending settlements must not reduce debt before the receiver confirms.
    const effectiveSettlements = settlements.filter(s => s.status === "CONFIRMED");

    // Calculate Balances using ALL expenses
    const balances = calculateBalances(
        members,
        allExpenses.map(e => ({ paidById: e.paidById, amount: e.amount, splits: e.splits })),
        effectiveSettlements,
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

    // Calculate last settlement date for filtering (only confirmed settlements mark a clean slate)
    const confirmedSettlements = settlements.filter(s => s.status === "CONFIRMED");
    const lastSettlementDate = getLastSettlementDate(confirmedSettlements);

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
        ...settlements.map((s) => ({
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
            <header className="flex justify-between items-start pt-2">
                <div>
                    <h1 className="text-[23px] font-bold tracking-[-0.02em] text-foreground">
                        Hola, {user.name}
                    </h1>
                    <div className="text-[13px] text-muted-foreground mt-1">
                        {partner ? `Pareja con ${partner.name}` : "Esperando a tu pareja..."}
                    </div>
                </div>
                <div className="flex items-center gap-3.5">
                    <Link href="/analytics">
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-transparent">
                            <BarChart2 className="h-5 w-5" />
                        </Button>
                    </Link>
                    <Link href="/settings">
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-transparent">
                            <Settings className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div className="h-[38px] w-[38px] rounded-full bg-[hsl(var(--surface-raised))] border border-white/[0.08] flex items-center justify-center font-bold text-sm text-primary overflow-hidden">
                        {isAvatarUrl(user.avatar) ? (
                            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                            <img src={user.avatar!} alt={user.name} className="h-full w-full object-cover" />
                        ) : (
                            user.name.charAt(0).toUpperCase()
                        )}
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-1 gap-4">
                <GlassCard className="p-0 flex flex-col items-center justify-center text-center overflow-hidden rounded-[20px]">
                    {!partner ? (
                        <div className="p-6">
                            <span className="text-[11px] uppercase font-semibold tracking-[0.18em] text-muted-foreground mb-1 block">Tu balance</span>
                            <h2 className="text-3xl font-bold text-foreground">Esperando...</h2>
                            <p className="text-sm text-muted-foreground mt-2">
                                Invita a tu pareja para empezar a registrar gastos juntos
                            </p>
                        </div>
                    ) : (
                        <div className="w-full">
                            <div className="pt-6 px-6">
                                <span className="text-[11px] uppercase font-semibold tracking-[0.18em] text-muted-foreground">Tu balance</span>
                                <h2
                                    data-testid="balance-amount"
                                    className={cn(
                                        "text-[40px] leading-none font-mono font-bold tracking-[-0.02em] mt-2",
                                        myBalanceCents > 0 ? "text-emerald-400" : myBalanceCents < 0 ? "text-primary" : "text-foreground"
                                    )}
                                >
                                    {myBalanceCents > 0 ? "+" : ""}{formatEuros(myBalance)}
                                </h2>
                            </div>

                            <VisualBalanceLazy
                                balance={myBalance}
                                user1={{ name: user.name, avatar: user.avatar }}
                                user2={{ name: partner.name, avatar: partner.avatar }}
                                className="mt-1.5 mb-1"
                            />

                            <div className="pb-[22px] px-6">
                                <span className="text-xs font-semibold tracking-[0.04em] text-[#a1a1aa]">
                                    {myBalanceCents > 0 ? `Te deben ${formatEuros(myBalance)}` :
                                        myBalanceCents < 0 ? `Debes ${formatEuros(Math.abs(myBalance))}` : "En equilibrio"}
                                </span>
                            </div>
                        </div>
                    )}
                </GlassCard>
            </section>

            {myPendingSettlements.length > 0 && (
                <PendingSettlements settlements={myPendingSettlements} />
            )}

            {/* Dashboard Actions */}
            <Link href="/settle" className="block">
                <div className="w-full h-[50px] rounded-[13px] bg-[hsl(var(--surface))] border border-white/[0.08] text-foreground font-semibold text-[15px] flex items-center justify-center cursor-pointer transition-all duration-150 hover:border-white/[0.18] active:scale-[0.98]">
                    Liquidar deuda
                </div>
            </Link>

            <section className="space-y-4">
                <h2 className="text-[13px] font-semibold tracking-[0.04em] uppercase text-muted-foreground">Resumen del mes</h2>
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

                    const percentChange = totalLastMonth > 0
                        ? ((totalThisMonth - totalLastMonth) / totalLastMonth * 100).toFixed(0)
                        : null;

                    const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

                    return (
                        <div className="space-y-2.5">
                            <div className="grid grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.06] rounded-[14px] overflow-hidden">
                                <div className="bg-[hsl(var(--surface))] py-4 px-2 text-center">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.05em]">Este mes</p>
                                    <p className="text-[15px] font-bold font-mono mt-1.5 text-foreground">{formatEuros(totalThisMonth)}</p>
                                </div>
                                <div className="bg-[hsl(var(--surface))] py-4 px-2 text-center">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.05em]">Top</p>
                                    <p className="text-[15px] font-bold mt-1.5 text-foreground">{topCategory ? getCategoryById(topCategory[0]).label : "—"}</p>
                                </div>
                                <div className="bg-[hsl(var(--surface))] py-4 px-2 text-center">
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.05em]">vs Anterior</p>
                                    <p className={cn(
                                        "text-[15px] font-bold font-mono mt-1.5",
                                        percentChange && Number(percentChange) > 0 ? "text-red-400" : "text-emerald-400"
                                    )}>
                                        {percentChange ? `${Number(percentChange) > 0 ? "+" : ""}${percentChange}%` : "—"}
                                    </p>
                                </div>
                            </div>

                            {/* Spending Breakdown Bar */}
                            {totalThisMonth > 0 && (
                                <GlassCard className="p-4 rounded-[14px] space-y-3.5">
                                    <div className="flex h-2 w-full rounded-md overflow-hidden bg-white/5 gap-0.5">
                                        {sortedCategories.map(([cat, amount]) => {
                                            const percentage = (amount / totalThisMonth) * 100;
                                            return (
                                                <div
                                                    key={cat}
                                                    className="h-full opacity-[0.85]"
                                                    style={{ width: `${percentage}%`, backgroundColor: getCategoryById(cat).hex }}
                                                    title={`${getCategoryById(cat).label}: ${formatEuros(amount)}`}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                                        {sortedCategories.slice(0, 4).map(([cat, amount]) => (
                                            <div key={cat} className="flex items-center gap-1.5">
                                                <div className="h-[7px] w-[7px] rounded-sm" style={{ backgroundColor: getCategoryById(cat).hex }} />
                                                <span className="text-[11px] font-medium text-[#a1a1aa]">
                                                    {getCategoryById(cat).label} · {((amount / totalThisMonth) * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </GlassCard>
                            )}
                        </div>
                    );
                })()}
            </section>

            {!partner && <InviteCard code={couple.code} />}

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-[13px] font-semibold tracking-[0.04em] uppercase text-muted-foreground">Recientes</h2>
                    {(allExpenses.length > 0 || settlements.length > 0) && (
                        <Link href="/expenses/list" className="text-[13px] text-primary hover:underline">
                            Ver todos →
                        </Link>
                    )}
                </div>

                <div className="space-y-2">
                    {combinedRecent.length === 0 ? (
                        (allExpenses.length > 0 || settlements.length > 0) ? (
                            <div className="text-center py-10 px-5 rounded-2xl border border-dashed border-white/10">
                                <p className="font-semibold text-[15px] text-foreground">Todo al día</p>
                                <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                                    No tenéis pagos pendientes.<br />
                                    Pulsa <span className="text-primary font-semibold">+</span> para añadir un gasto.
                                </p>
                                <Link href="/expenses/list">
                                    <Button variant="ghost" size="sm" className="mt-3 text-xs h-auto p-0 text-primary hover:bg-transparent hover:underline">
                                        Ver historial completo
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center py-12 px-5 rounded-2xl border border-dashed border-white/10">
                                <p className="font-semibold text-[15px] text-foreground">{partner ? "Sin movimientos aún" : "Casi listos"}</p>
                                <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                                    {partner
                                        ? <>Pulsa <span className="text-primary font-semibold">+</span> para añadir vuestro primer gasto.</>
                                        : "Comparte el enlace de arriba para que tu pareja se una."
                                    }
                                </p>
                            </div>
                        )
                    ) : (
                        combinedRecent.map((item) => {
                            if (item.type === "EXPENSE") {
                                return (
                                    <ExpenseCard
                                        key={item.id}
                                        expense={item as Expense}
                                        paidByUser={usersMap[item.paidBy]}
                                        allUsers={usersMap}
                                    />
                                );
                            } else {
                                const fromUser = usersMap[item.paidBy];
                                const toUser = item.toUserId ? usersMap[item.toUserId] : null;

                                return (
                                    <Link href={`/settle/${item.id}`} key={item.id}>
                                        <div className="flex items-center gap-[13px] p-[13px] rounded-2xl bg-[hsl(var(--surface))] border border-white/5 cursor-pointer transition-all duration-150 hover:border-white/[0.14] active:scale-[0.99]">
                                            <div className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center shrink-0 bg-[hsl(var(--surface-raised))] border border-white/5 text-muted-foreground">
                                                <ArrowLeftRight className="h-[18px] w-[18px]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-semibold text-[15px] text-foreground">Liquidación</h3>
                                                <div className="flex items-center gap-[7px] mt-[3px]">
                                                    <span className="text-[11px] text-muted-foreground truncate">{fromUser?.name} → {toUser?.name}</span>
                                                    <span className="h-[2px] w-[2px] rounded-full bg-white/20 shrink-0" />
                                                    <span className="text-[11px] text-muted-foreground shrink-0">{getSettlementMethodLabel(item.method)}</span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[15px] font-mono font-semibold text-foreground">
                                                    {formatEuros(item.amount)}
                                                </p>
                                                <span className="text-[10px] uppercase font-medium tracking-wider text-muted-foreground">
                                                    {getSettlementStatusLabel(item.status)}
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            }
                        })
                    )}
                </div>
            </section>

            {partner ? (
                <div className="fixed bottom-[30px] right-6 z-50">
                    <Link href="/expenses/new">
                        <Button size="icon" className="h-14 w-14 rounded-full shadow-[0_10px_28px_-10px_rgba(0,0,0,0.8)] bg-primary hover:bg-primary/90 active:scale-90 transition-transform">
                            <Plus className="h-6 w-6" />
                        </Button>
                    </Link>
                </div>
            ) : (
                <div className="fixed bottom-[30px] right-6 z-50">
                    <Button size="icon" className="h-14 w-14 rounded-full bg-white/10 cursor-not-allowed opacity-50" disabled>
                        <Plus className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div>
    );
}
