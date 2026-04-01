import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowLeft, Check, Calendar, CreditCard, User } from "lucide-react";
import Link from "next/link";
import { toEuros } from "@/lib/currency";

interface SettlementDetailPageProps {
    params: { id: string };
}

export default async function SettlementDetailPage({ params }: SettlementDetailPageProps) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: {
            fromUser: true,
            toUser: true,
            expenses: {
                include: {
                    splits: true
                }
            }
        }
    });

    if (!settlement) notFound();

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/expenses/list">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold">Detalle de Liquidación</h1>
                </div>
                {settlement.fromUserId === session.userId && (
                    <Link href={`/settle/${id}/edit`}>
                        <Button variant="ghost" size="sm" className="rounded-full border border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
                            Editar
                        </Button>
                    </Link>
                )}
            </header>

            <GlassCard className="p-6 space-y-6 border-blue-500/30 bg-blue-500/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5">
                    <Check className="h-24 w-24 text-blue-400" />
                </div>

                <div className="text-center space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Total Liquidado</p>
                    <h2 className="text-5xl font-mono font-bold text-white">
                        {toEuros(settlement.amount).toFixed(2)}€
                    </h2>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/30">
                        <Check className="h-3 w-3" /> {settlement.status}
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                    <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">De</p>
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center text-xs">
                                {settlement.fromUser.avatar || "👤"}
                            </div>
                            <span className="text-sm font-bold truncate">{settlement.fromUser.name}</span>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Para</p>
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center text-xs">
                                {settlement.toUser.avatar || "👤"}
                            </div>
                            <span className="text-sm font-bold truncate">{settlement.toUser.name}</span>
                        </div>
                    </div>
                </div>

                <div className="border-t border-white/10 pt-4 grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs">{new Date(settlement.date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <CreditCard className="h-4 w-4" />
                        <span className="text-xs">{settlement.method}</span>
                    </div>
                </div>
            </GlassCard>

            <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    Gastos Cubiertos ({settlement.expenses.length})
                </h3>

                <div className="space-y-3">
                    {settlement.expenses.length === 0 ? (
                        <p className="text-center py-10 text-sm text-muted-foreground border border-dashed border-white/10 rounded-xl">
                            Esta liquidación se hizo de forma global sin vincular gastos específicos.
                        </p>
                    ) : (
                        settlement.expenses.map((expense) => {
                            let myShareCents = 0;
                            if (expense.splits.length > 0) {
                                myShareCents = expense.splits.find(s => s.userId === settlement.fromUserId)?.amount || 0;
                            } else {
                                // Assume 50/50 if no splits (legacy or simple)
                                myShareCents = Math.floor(expense.amount / 2);
                            }

                            return (
                                <GlassCard key={expense.id} className="p-4 flex items-center justify-between border-white/5 bg-white/5">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-sm">
                                            {expense.category === 'food' ? '🍕' :
                                                expense.category === 'transport' ? '🚗' :
                                                    expense.category === 'entertainment' ? '🎬' : '📦'}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold">{expense.description}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {new Date(expense.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-mono font-bold">{toEuros(myShareCents).toFixed(2)}€</p>
                                        <p className="text-[10px] text-muted-foreground italic">de {toEuros(expense.amount).toFixed(2)}€</p>
                                    </div>
                                </GlassCard>
                            );
                        })
                    )}
                </div>
            </section>
        </div>
    );
}
