"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Wallet, Info } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface SettleExpense {
    id: string;
    description: string;
    amount: number;
    myAmount: number;
    date: string;
    category: string;
    paidBy: string;
}

interface EditSettleClientProps {
    settlementId: string;
    expenses: SettleExpense[];
    initialExpenseIds: string[];
    initialMethod: "CASH" | "BIZUM";
    toUser: {
        id: string;
        name: string;
        avatar: string;
    };
}

export function EditSettleClient({
    settlementId,
    expenses,
    initialExpenseIds,
    initialMethod,
    toUser
}: EditSettleClientProps) {
    const router = useRouter();
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(initialExpenseIds);
    const [method, setMethod] = useState<"CASH" | "BIZUM">(initialMethod);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filter expenses to only show those paid by the "toUser"
    const debtorExpenses = expenses.filter(e => e.paidBy === toUser.id);

    const amount = useMemo(() => {
        return debtorExpenses
            .filter(e => selectedExpenseIds.includes(e.id))
            .reduce((sum, e) => sum + e.myAmount, 0);
    }, [debtorExpenses, selectedExpenseIds]);

    const toggleExpense = (id: string) => {
        setSelectedExpenseIds(prev =>
            prev.includes(id) ? prev.filter(eid => eid !== id) : [...prev, id]
        );
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/settle/${settlementId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    method,
                    expenseIds: selectedExpenseIds
                })
            });
            if (res.ok) {
                router.push(`/settle/${settlementId}`);
                router.refresh();
            } else {
                alert("Error al actualizar la liquidación");
            }
        } catch (e) {
            console.error(e);
            alert("Error de conexión");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 py-4">
                <Link href={`/settle/${settlementId}`}>
                    <Button variant="ghost" size="icon" className="rounded-full">
                        <ArrowLeft />
                    </Button>
                </Link>
                <h1 className="text-lg font-bold">Editar Liquidación</h1>
            </header>

            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-xl">
                        {toUser.avatar}
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Pagando a</p>
                        <p className="font-bold">{toUser.name}</p>
                    </div>
                </div>

                <div className="text-center py-6 space-y-2">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Nuevo Total</p>
                    <h2 className="text-5xl font-mono font-bold text-white">
                        {amount.toFixed(2)}€
                    </h2>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 text-muted-foreground text-[10px] font-bold border border-white/10 uppercase tracking-widest">
                        <Info className="h-3 w-3" /> Basado en {selectedExpenseIds.length} gastos
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-sm font-bold uppercase tracking-widest ml-1 text-muted-foreground">Gastos Seleccionados</p>
                    <div className="space-y-2">
                        {debtorExpenses.map((expense) => (
                            <div
                                key={expense.id}
                                onClick={() => toggleExpense(expense.id)}
                                className={cn(
                                    "flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]",
                                    selectedExpenseIds.includes(expense.id)
                                        ? "bg-primary/20 border-primary shadow-lg shadow-primary/10"
                                        : "bg-white/5 border-white/5 opacity-60"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "h-5 w-5 rounded-md border flex items-center justify-center transition-colors",
                                        selectedExpenseIds.includes(expense.id) ? "bg-primary border-primary" : "border-white/20"
                                    )}>
                                        {selectedExpenseIds.includes(expense.id) && <Check className="h-3.5 w-3.5 text-black font-bold" />}
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-bold leading-none mb-1">{expense.description}</p>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                            {new Date(expense.date).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-mono font-bold">{expense.myAmount.toFixed(2)}€</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-sm font-bold uppercase tracking-widest ml-1 text-muted-foreground">Método de Pago</p>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setMethod("BIZUM")}
                            className={cn(
                                "p-4 rounded-xl border flex flex-col items-center gap-2 transition-all",
                                method === "BIZUM" ? "bg-primary/20 border-primary" : "bg-white/5 border-white/5"
                            )}
                        >
                            <Wallet className="h-6 w-6 text-emerald-400" />
                            <span className="font-bold text-xs">Bizum / Transf.</span>
                        </button>
                        <button
                            onClick={() => setMethod("CASH")}
                            className={cn(
                                "p-4 rounded-xl border flex flex-col items-center gap-2 transition-all",
                                method === "CASH" ? "bg-primary/20 border-primary" : "bg-white/5 border-white/5"
                            )}
                        >
                            <span className="text-2xl">💵</span>
                            <span className="font-bold text-xs">Efectivo</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-md border-t border-white/10 z-50">
                <div className="max-w-md mx-auto">
                    <Button
                        className="w-full h-14 text-lg font-bold shadow-2xl shadow-primary/30"
                        isLoading={isSubmitting}
                        onClick={handleSubmit}
                        disabled={selectedExpenseIds.length === 0}
                    >
                        Guardar Cambios <Check className="ml-2" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
