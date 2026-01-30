import { Button } from "@/components/ui/button";
import { ArrowLeft, Heart, Calculator, User } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReceiptItem } from "@/types";
import { DeleteExpenseButton } from "@/components/expense/delete-button";
import { EditExpenseButton } from "@/components/expense/edit-button";
import { getSession } from "@/lib/auth";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const expense = await prisma.expense.findUnique({
        where: { id: id },
        include: {
            paidBy: true,
            splits: {
                include: {
                    user: true
                }
            },
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!expense) redirect("/dashboard");

    const isMe = userId === expense.paidById;
    const partner = expense.couple.members.find(m => m.id !== expense.paidById);
    const splitWithPartner = expense.splits.length === 2; // If 2 splits, it's 50/50

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-2 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold truncate">{expense.description}</h1>
                    <p className="text-xs text-muted-foreground">{new Date(expense.date).toLocaleDateString()}</p>
                </div>
                <EditExpenseButton
                    expenseId={expense.id}
                    initialData={{
                        description: expense.description,
                        amount: expense.amount,
                        category: expense.category,
                        splitWithPartner,
                        partnerName: partner?.name,
                    }}
                />
                <DeleteExpenseButton expenseId={expense.id} />
            </header>

            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center py-6 bg-white/5 rounded-3xl border border-white/10">
                    <p className="text-sm text-muted-foreground uppercase tracking-widest font-bold mb-2">Importe Total</p>
                    <h2 className="text-6xl font-mono font-bold tracking-tighter">
                        {expense.amount.toFixed(2)}<span className="text-3xl ml-1 text-muted-foreground">€</span>
                    </h2>
                    <div className="mt-4 flex items-center justify-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                            {expense.paidBy.avatar || "👤"}
                        </div>
                        <p className="text-sm font-medium">Pagado por <span className="text-primary">{isMe ? "Ti" : expense.paidBy.name}</span></p>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1 flex items-center gap-2">
                        <Heart className="h-4 w-4 fill-primary text-primary" />
                        Reparto en Pareja
                    </h3>
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
                                            <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs overflow-hidden text-lg">
                                                {split.user.avatar || "👤"}
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{split.userId === userId ? "Ti" : split.user.name}</p>
                                                {split.userId === expense.paidById && (
                                                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-tighter">Aportación</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono font-bold">{split.amount.toFixed(2)}€</p>
                                            <p className="text-[10px] text-muted-foreground uppercase">Cargo</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {expense.receiptData && (expense.receiptData as any).length > 0 && (
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1 flex items-center gap-2">
                            <Calculator className="h-4 w-4 text-primary" />
                            Desglose de Compra
                        </h3>
                        <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/20">
                            <div className="divide-y divide-white/5">
                                {(expense.receiptData as unknown as ReceiptItem[]).map((item, idx) => (
                                    <div key={idx} className="grid grid-cols-[auto_1fr_auto_auto] gap-3 p-3 items-center text-sm">
                                        {/* Assignment indicator */}
                                        <div className={`h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center ${item.assignedTo ? 'bg-pink-500/20 text-pink-400' : 'bg-white/5 text-muted-foreground'}`}>
                                            {item.assignedTo ? <User className="h-3.5 w-3.5" /> : <Heart className="h-3.5 w-3.5" />}
                                        </div>
                                        <div className="font-medium break-words leading-tight py-1">{item.description}</div>
                                        <div className="text-right text-muted-foreground text-[10px] leading-tight min-w-[60px]">
                                            {item.quantity > 1 && (
                                                <div className="flex flex-col">
                                                    <span>{item.quantity} x</span>
                                                    <span>{item.price.toFixed(2)}€</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="font-mono font-bold text-right w-16 flex-shrink-0">
                                            {item.total.toFixed(2)}€
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Summary footer with shared vs personal breakdown */}
                            {(expense.receiptData as unknown as ReceiptItem[]).some(i => i.assignedTo) && (
                                <div className="bg-white/5 p-3 space-y-2 border-t border-white/5">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> Común (50/50)</span>
                                        <span>{(expense.receiptData as unknown as ReceiptItem[]).filter(i => !i.assignedTo).reduce((acc, i) => acc + i.total, 0).toFixed(2)}€</span>
                                    </div>
                                    <div className="flex justify-between text-xs text-pink-400">
                                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Solo {partner?.name}</span>
                                        <span>{(expense.receiptData as unknown as ReceiptItem[]).filter(i => i.assignedTo).reduce((acc, i) => acc + i.total, 0).toFixed(2)}€</span>
                                    </div>
                                </div>
                            )}
                            <div className="bg-white/5 p-3 flex justify-between items-center border-t border-white/5">
                                <span className="font-bold text-sm text-muted-foreground">Total Detallado</span>
                                <span className="font-mono font-bold">
                                    {(expense.receiptData as unknown as ReceiptItem[]).reduce((acc, i) => acc + i.total, 0).toFixed(2)}€
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {expense.receiptUrl && (
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">Ticket de Compra</h3>
                        <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/5">
                            <img
                                src={expense.receiptUrl}
                                alt="Ticket"
                                className="w-full h-auto max-h-[400px] object-contain mx-auto"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
