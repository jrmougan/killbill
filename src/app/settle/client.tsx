"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Plus, Trash2, Wallet, Receipt, ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Debtor {
    userId: string;
    name: string;
    avatar: string;
    amount: number;
}

interface ExpenseCandidate {
    id: string;
    description: string;
    amount: number;
    date: string;
    paidById: string;
    myShare: number;
    remaining: number;
    status: string; // NEW
}

interface SettleClientProps {
    debts: Debtor[];
    candidates: ExpenseCandidate[];
    creditCandidates: ExpenseCandidate[];
    forbiddenPairs: Record<string, string[]>;
}

interface PaymentItem {
    id: string;
    type: "CASH" | "BIZUM" | "TRANSFER" | "EXPENSE";
    amount: number;
    description?: string;
    category?: string;
    expenseId?: string;
}

export function SettleClient({ debts, candidates, creditCandidates, forbiddenPairs }: SettleClientProps) {
    const router = useRouter();
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1: User
    const [selectedUserId, setSelectedUserId] = useState<string | null>(debts.length > 0 ? debts[0].userId : null);

    // Step 2: Debts
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);

    // Step 3: Payments
    const [payments, setPayments] = useState<PaymentItem[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showExpenseSelector, setShowExpenseSelector] = useState(false);

    // Derived Logic
    const availableExpenses = useMemo(() =>
        candidates.filter(c => c.paidById === selectedUserId),
        [candidates, selectedUserId]);

    const availableCreditExpenses = useMemo(() =>
        creditCandidates.filter(c => {
            // 1. Existing check: Not already selected in current payments
            if (payments.find(p => p.expenseId === c.id)) return false;

            // 2. Constraint: Unique Pair
            if (selectedExpenseIds.some(debtId => forbiddenPairs[debtId]?.includes(c.id))) {
                return false;
            }
            return true;
        }),
        [creditCandidates, payments, selectedExpenseIds, forbiddenPairs]);

    const totalSelectedDebt = useMemo(() => {
        return availableExpenses
            .filter(e => selectedExpenseIds.includes(e.id))
            .reduce((sum, e) => sum + e.remaining, 0);
    }, [availableExpenses, selectedExpenseIds]);

    const totalPayment = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
    const remainingToPay = Math.max(0, totalSelectedDebt - totalPayment);

    // Actions
    const handleToggleExpense = (id: string) => {
        if (selectedExpenseIds.includes(id)) {
            setSelectedExpenseIds(prev => prev.filter(e => e !== id));
        } else {
            setSelectedExpenseIds(prev => [...prev, id]);
        }
    };

    const handleSelectAll = () => {
        if (selectedExpenseIds.length === availableExpenses.length) {
            setSelectedExpenseIds([]);
        } else {
            setSelectedExpenseIds(availableExpenses.map(e => e.id));
        }
    };

    const addPayment = (type: PaymentItem["type"], amount: number, desc?: string, expenseId?: string) => {
        setPayments(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            type,
            amount,
            description: desc,
            category: "other",
            expenseId
        }]);
    };

    const handleSubmit = async () => {
        if (!selectedUserId) return;
        setIsSubmitting(true);
        try {
            let remainingPayment = payments.reduce((sum, p) => sum + p.amount, 0);
            const debtsPayload: { expenseId: string, amount: number }[] = [];

            // Greedy Distribution: Pay oldest/selected debts first
            const selectedExpenses = availableExpenses.filter(e => selectedExpenseIds.includes(e.id));

            for (const expense of selectedExpenses) {
                if (remainingPayment <= 0.001) break;

                const payAmount = Math.min(expense.remaining, remainingPayment);
                debtsPayload.push({ expenseId: expense.id, amount: payAmount });
                remainingPayment -= payAmount;
            }

            const paymentsPayload = payments.map(p => ({
                type: p.type,
                amount: p.amount,
                description: p.description,
                category: p.category,
                expenseId: p.expenseId
            }));

            await fetch("/api/settle/detailed", {
                method: "POST",
                body: JSON.stringify({
                    fromUserId: "me",
                    toUserId: selectedUserId,
                    debts: debtsPayload,
                    payments: paymentsPayload,
                    status: "PENDING"
                })
            });
            router.push("/dashboard");
            router.refresh();
        } catch (e) {
            console.error(e);
            alert("Error settling debt");
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- RENDER ---

    if (debts.length === 0) {
        return (
            <div className="flex flex-col min-h-screen p-6 justify-center text-center space-y-6">
                <header className="absolute top-4 left-4">
                    <Link href="/dashboard">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                </header>
                <div className="space-y-2">
                    <h1 className="text-2xl font-bold">Todo en orden</h1>
                    <p className="text-muted-foreground">No debes dinero a nadie.</p>
                </div>
                <Link href="/dashboard">
                    <Button className="w-full">Volver al Dashboard</Button>
                </Link>
            </div>
        )
    }

    return (
        <div className="flex flex-col min-h-screen p-4 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 py-4">
                {step === 1 ? (
                    <Link href="/dashboard">
                        <Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft /></Button>
                    </Link>
                ) : (
                    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setStep(prev => prev - 1 as any)}><ArrowLeft /></Button>
                )}
                <h1 className="text-lg font-bold">
                    {step === 1 && "Liquidar Deuda"}
                    {step === 2 && "Seleccionar Gastos"}
                    {step === 3 && "Realizar Pago"}
                </h1>
            </header>

            {/* STEP 1: SELECT DEBTOR */}
            {step === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                    <p className="text-muted-foreground px-2">¿A quién quieres pagar?</p>
                    <div className="space-y-2">
                        {debts.map(debt => (
                            <div
                                key={debt.userId}
                                onClick={() => {
                                    setSelectedUserId(debt.userId);
                                    // Pre-select all expenses? No, let user choose.
                                }}
                                className={cn(
                                    "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                                    selectedUserId === debt.userId ? "bg-primary/20 border-primary" : "bg-card border-white/10"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-primary to-purple-500 p-[2px]">
                                        <div className="h-full w-full rounded-full bg-black flex items-center justify-center font-bold text-xs overflow-hidden">
                                            {debt.avatar}
                                        </div>
                                    </div>
                                    <div className="text-left">
                                        <p className="font-bold">{debt.name}</p>
                                        <p className="text-xs text-muted-foreground">Debes {debt.amount.toFixed(2)}€</p>
                                    </div>
                                </div>
                                {selectedUserId === debt.userId && <Check className="text-primary h-5 w-5" />}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* STEP 2: SELECT EXPENSES */}
            {step === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 flex flex-col h-full">
                    <div className="flex justify-between items-center px-1">
                        <p className="text-muted-foreground">Gastos pendientes</p>
                        <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                            {selectedExpenseIds.length === availableExpenses.length ? "Deseleccionar" : "Todas"}
                        </Button>
                    </div>

                    <div className="space-y-2 flex-1 overflow-y-auto pb-4">
                        {availableExpenses.map(expense => (
                            <div
                                key={expense.id}
                                onClick={() => handleToggleExpense(expense.id)}
                                className={cn(
                                    "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                                    selectedExpenseIds.includes(expense.id) ? "bg-primary/20 border-primary" : "bg-card border-white/10"
                                )}
                            >
                                <div className="flex-1">
                                    <div className="flex justify-between items-center">
                                        <p className="font-bold">{expense.description}</p>
                                        <div className="flex items-center gap-2">
                                            {expense.status === 'PARTIAL' && (
                                                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Partial</span>
                                            )}
                                            <p className="font-mono">{expense.remaining.toFixed(2)}€</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{new Date(expense.date).toLocaleDateString()}</p>
                                </div>
                                <div className={cn("ml-4 h-5 w-5 rounded-full border flex items-center justify-center",
                                    selectedExpenseIds.includes(expense.id) ? "bg-primary border-primary" : "border-white/30"
                                )}>
                                    {selectedExpenseIds.includes(expense.id) && <Check className="h-3 w-3 text-black" />}
                                </div>
                            </div>
                        ))}
                        {availableExpenses.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground">
                                No hay gastos específicos pendientes.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* STEP 3: PAYMENT METHODS */}
            {step === 3 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 relative">
                    {/* Expense Selector Overlay */}
                    {showExpenseSelector && (
                        <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-sm rounded-xl p-4 flex flex-col animate-in fade-in zoom-in-95">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold">Elige un gasto</h3>
                                <Button size="sm" variant="ghost" onClick={() => setShowExpenseSelector(false)}>Cerrar</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2">
                                {availableCreditExpenses.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-10">No tienes gastos disponibles para compensar.</p>
                                ) : availableCreditExpenses.map(e => (
                                    <div key={e.id}
                                        onClick={() => {
                                            // Max amount is min(remainingToPay, e.remaining)
                                            const amount = Math.min(remainingToPay || totalSelectedDebt, e.remaining);
                                            addPayment("EXPENSE", amount, e.description, e.id);
                                            setShowExpenseSelector(false);
                                        }}
                                        className="p-3 border border-white/10 rounded-lg bg-white/5 active:bg-white/10 cursor-pointer"
                                    >
                                        <div className="flex justify-between font-bold">
                                            <span>{e.description}</span>
                                            <span className="text-emerald-400">{e.remaining.toFixed(2)}€</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString()}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="bg-card p-4 rounded-xl border border-white/10 space-y-4">
                        <div className="flex justify-between items-end">
                            <span className="text-muted-foreground">Total a Pagar</span>
                            <span className="text-3xl font-bold">{totalSelectedDebt.toFixed(2)}€</span>
                        </div>
                        <div className="h-[1px] bg-white/10" />
                        <div className="space-y-2">
                            {payments.map(p => (
                                <div key={p.id} className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        {p.type === "EXPENSE" ? <Receipt className="h-4 w-4 text-purple-400" /> : <Wallet className="h-4 w-4 text-emerald-400" />}
                                        <span>{p.type === "EXPENSE" ? p.description : "Efectivo / Bizum"}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span>{p.amount.toFixed(2)}€</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => setPayments(prev => prev.filter(x => x.id !== p.id))}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            {payments.length === 0 && <p className="text-sm text-yellow-500/80 italic">Añade métodos de pago para cubrir la deuda.</p>}
                        </div>
                        {remainingToPay > 0.01 && (
                            <div className="flex justify-end pt-2">
                                <span className="text-xs text-muted-foreground">Faltan: <span className="text-red-400 font-bold">{remainingToPay.toFixed(2)}€</span></span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Button
                            variant="ghost"
                            className="h-auto py-4 flex flex-col gap-2 border border-emerald-500/20 hover:bg-emerald-500/10"
                            onClick={() => addPayment("BIZUM", remainingToPay || totalSelectedDebt)} // Default to remaining
                            disabled={remainingToPay < 0.01}
                        >
                            <Wallet className="h-6 w-6 text-emerald-500" />
                            <span>Efectivo / Bizum</span>
                        </Button>
                        <Button
                            variant="ghost"
                            className="h-auto py-4 flex flex-col gap-2 border border-purple-500/20 hover:bg-purple-500/10"
                            onClick={() => setShowExpenseSelector(true)}
                            disabled={remainingToPay < 0.01}
                        >
                            <Receipt className="h-6 w-6 text-purple-500" />
                            <span>Compensar con Gasto</span>
                        </Button>
                    </div>
                </div>
            )}

            {/* FOOTER ACTIONS */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-md border-t border-white/10">
                <div className="max-w-md mx-auto flex gap-2">
                    {step === 1 && (
                        <Button className="w-full" onClick={() => setStep(2)}>
                            Seleccionar Deudas <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                    {step === 2 && (
                        <Button className="w-full"
                            disabled={selectedExpenseIds.length === 0}
                            onClick={() => {
                                // Default payment: Cash for full amount
                                if (payments.length === 0) {
                                    setPayments([{ id: "default", type: "BIZUM", amount: totalSelectedDebt }]);
                                }
                                setStep(3)
                            }}
                        >
                            Continuar ({totalSelectedDebt.toFixed(2)}€) <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                    {step === 3 && (
                        <Button className="w-full" size="lg"
                            disabled={totalPayment <= 0 || totalPayment > totalSelectedDebt + 0.05 || isSubmitting}
                            isLoading={isSubmitting}
                            onClick={handleSubmit}
                        >
                            {remainingToPay > 0.05 ? "Confirmar Pago Parcial" : "Confirmar Liquidación"} <Check className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
