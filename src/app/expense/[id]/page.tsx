import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, FileText, User, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function ExpenseDetailPage({ params }: { params: { id: string } }) {
    const cookieStore = await cookies();
    const userId = cookieStore.get("user_id")?.value;
    if (!userId) redirect("/login");

    const expense = await prisma.expense.findUnique({
        where: { id: params.id },
        include: {
            paidBy: true,
            settlementDebts: {
                include: { settlement: { include: { fromUser: true, toUser: true } } }
            },
            settlementPayments: {
                include: { settlement: { include: { fromUser: true, toUser: true } } }
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

                {/* Audit Trail: Settlements where this expense was PAID OFF (Debt) */}
                {expense.settlementDebts.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Wallet className="h-5 w-5 text-emerald-400" /> Liquidaciones Recibidas
                        </h3>
                        {expense.settlementDebts.map(sd => (
                            <div key={sd.id} className="p-4 rounded-xl bg-card border border-emerald-500/20 flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-sm">Pago de {sd.settlement.fromUser.name}</p>
                                    <p className="text-xs text-muted-foreground">{new Date(sd.settlement.date).toLocaleDateString()}</p>
                                </div>
                                <span className="font-mono font-bold text-emerald-400">-{sd.amount.toFixed(2)}€</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Audit Trail: Settlements where this expense was USED AS PAYMENT (Credit) */}
                {expense.settlementPayments.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Receipt className="h-5 w-5 text-purple-400" /> Usado como Pago
                        </h3>
                        {expense.settlementPayments.map(sp => (
                            <div key={sp.id} className="p-4 rounded-xl bg-card border border-purple-500/20 flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-sm">Compensaste deuda con {sp.settlement.toUser.name}</p>
                                    <p className="text-xs text-muted-foreground">{new Date(sp.settlement.date).toLocaleDateString()}</p>
                                </div>
                                <span className="font-mono font-bold text-purple-400">-{sp.amount.toFixed(2)}€</span>
                            </div>
                        ))}
                    </div>
                )}

                {expense.settlementDebts.length === 0 && expense.settlementPayments.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground border border-dashed border-white/10 rounded-xl">
                        No hay movimientos de liquidación asociados.
                    </div>
                )}
            </div>
        </div>
    );
}
