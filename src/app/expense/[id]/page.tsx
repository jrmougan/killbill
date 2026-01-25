import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, FileText, User, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const expense = await prisma.expense.findUnique({
        where: { id: id },
        include: {
            paidBy: true,
            splits: {
                include: {
                    user: true
                }
            }
        }
    });

    if (!expense) return <div className="p-4">Gasto no encontrado</div>;

    // Is this my expense?
    const isPayer = expense.paidById === userId;

    return (
        <div className="flex flex-col min-h-screen bg-black text-white p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 py-4">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft /></Button>
                </Link>
                <h1 className="text-lg font-bold">Detalle del Gasto</h1>
            </header>

            <div className="space-y-6">
                <div className="bg-card p-6 rounded-2xl border border-white/10 space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold">{expense.description}</h2>
                            <div className="flex items-center gap-2 text-muted-foreground mt-1">
                                <Calendar className="h-4 w-4" />
                                <span className="text-sm">{new Date(expense.date).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-3xl font-mono font-bold">{expense.amount.toFixed(2)}€</span>
                            <div className="mt-2 text-xs uppercase font-bold tracking-wider">
                                <span className={
                                    expense.status === 'SETTLED' ? "text-emerald-400" :
                                        expense.status === 'PARTIAL' ? "text-yellow-400" : "text-blue-400"
                                }>{expense.status}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 p-[2px]">
                            <div className="h-full w-full rounded-full bg-black flex items-center justify-center font-bold text-xs overflow-hidden">
                                {expense.paidBy.avatar}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Pagado por</p>
                            <p className="font-bold">{isPayer ? "Ti" : expense.paidBy.name}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">Reparto</h3>
                    <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
                        {expense.splits.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground border-dashed border-white/10">
                                No hay detalles de reparto para este gasto.
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {expense.splits.map((split: any) => (
                                    <div key={split.id} className="flex items-center justify-between p-4 bg-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs overflow-hidden">
                                                {split.user.avatar || "👤"}
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{split.userId === userId ? "Ti" : split.user.name}</p>
                                                {split.userId === expense.paidById && (
                                                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-tighter">Pagador</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono font-bold">{split.amount.toFixed(2)}€</p>
                                            <p className="text-[10px] text-muted-foreground uppercase">Deuda</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
