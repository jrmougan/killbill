"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Wallet, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { isAvatarUrl } from "@/lib/avatar";
import { formatEuros } from "@/lib/currency";
import { GuestBanner } from "@/components/guest/guest-banner";

interface Debtor {
    userId: string;
    name: string;
    avatar: string;
    amount: number;
}

interface SettleExpense {
    id: string;
    description: string;
    amount: number;
    myAmount: number;
    date: string;
    category: string;
    paidBy: string;
}

interface SettleClientProps {
    debts: Debtor[];
    expenses: SettleExpense[];
    isGuest?: boolean;
    partner: {
        id: string;
        name: string;
        avatar: string;
    } | null;
}

export function SettleClient({ debts, expenses, isGuest = false, partner }: SettleClientProps) {
    const router = useRouter();
    const [step, setStep] = useState<1 | 2>(1);

    // Step 1: User
    const [selectedUserId, setSelectedUserId] = useState<string | null>(debts.length > 0 ? debts[0].userId : null);

    // Expense selection - REMOVED for Running Balance model. We just pay the debt.
    // const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);

    // Step 2: Payment
    const [amount, setAmount] = useState<string>("");
    const [method, setMethod] = useState<"CASH" | "BIZUM">("BIZUM");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedDebtor = debts.find(d => d.userId === selectedUserId);
    const debtorExpenses = expenses.filter(e => e.paidBy === selectedUserId);

    // Toggle logic removed

    const handleSubmit = async () => {
        if (!selectedUserId || !amount) return;
        setIsSubmitting(true);
        try {
            await fetch("/api/settle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    toUserId: selectedUserId,
                    amount: parseFloat(amount),
                    method,
                    // expenseIds: selectedExpenseIds // No specified expenses
                })
            });
            router.push("/dashboard");
            router.refresh(); // Refresh server data
        } catch (e) {
            console.error(e);
            alert("Error settling debt");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (debts.length === 0) {
        // Check if there are unsettled expenses to be archived
        const hasUnsettledActivity = expenses.length > 0;

        const handleArchive = async () => {
            // Pairwise checkpoint (Fase 1 fix): the old code sent a single 0-€
            // settlement to an arbitrary "partner", which only cleared ONE pair in a
            // group. Instead, checkpoint every counterparty with unsettled activity
            // (the distinct payers of the visible expenses), so each pair is cleared.
            const counterparties = Array.from(new Set(expenses.map((e) => e.paidBy)));
            const targets = counterparties.length > 0 ? counterparties : partner ? [partner.id] : [];
            if (targets.length === 0) return;
            if (!confirm("Esto marcará toda la actividad actual como 'Saldada' para limpiar la vista. ¿Continuar?")) return;

            setIsSubmitting(true);
            setError(null);
            try {
                // 0-amount settlement = archive/checkpoint, one per counterparty.
                const results = await Promise.all(
                    targets.map((toUserId) =>
                        fetch("/api/settle", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ toUserId, amount: 0, method: "CASH" }),
                        })
                    )
                );
                if (results.some((r) => !r.ok)) {
                    setError("No se pudo archivar todo el historial");
                    return;
                }
                router.push("/dashboard");
                router.refresh();
            } catch (e) {
                console.error(e);
                setError("No se pudo archivar el historial");
            } finally {
                setIsSubmitting(false);
            }
        };

        return (
            <div className="flex flex-col min-h-screen p-6 justify-center text-center space-y-6 relative">
                <header className="absolute top-4 left-4">
                    <Link href="/dashboard">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                </header>

                <div className="space-y-4">
                    <div className="text-6xl animate-bounce">
                        {hasUnsettledActivity ? "🧹" : "✨"}
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold">Todo en orden</h1>
                        <p className="text-muted-foreground">
                            {hasUnsettledActivity
                                ? "Cuentas saldadas, pero hay actividad reciente visible."
                                : "No tienes deudas pendientes."}
                        </p>
                    </div>
                </div>

                <GuestBanner show={isGuest} />

                {/* Archiving/checkpoint is a space-management action — not offered to guests. */}
                {hasUnsettledActivity && !isGuest && (
                    <div className="space-y-3 pt-4">
                        <Button
                            className="w-full h-12 bg-card border border-[color:var(--line)] text-foreground hover:bg-secondary"
                            variant="secondary"
                            onClick={handleArchive}
                            isLoading={isSubmitting}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Archivar historial
                        </Button>
                        <p className="text-[10px] text-muted-foreground">
                            Esto vaciará la lista de &quot;Pendientes&quot; en el inicio.
                        </p>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                    </div>
                )}

                <Link href="/dashboard">
                    <Button className={cn("w-full", !hasUnsettledActivity && "mt-4")}>
                        Volver al Dashboard
                    </Button>
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
                    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setStep(1)}><ArrowLeft /></Button>
                )}
                <h1 className="text-lg font-bold">
                    {step === 1 && "Liquidar Deuda"}
                    {step === 2 && "Realizar Pago"}
                </h1>
            </header>

            {step === 1 && <GuestBanner show={isGuest} />}

            {/* STEP 1: SELECT DEBTOR */}
            {step === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                    <p className="text-muted-foreground px-2">¿A quién quieres pagar?</p>
                    <div className="space-y-2">
                        {debts.map(debt => (
                            <button
                                key={debt.userId}
                                type="button"
                                onClick={() => {
                                    setSelectedUserId(debt.userId);
                                    setAmount(debt.amount.toFixed(2)); // Default to full amount
                                }}
                                className={cn(
                                    "w-full flex items-center justify-between p-4 rounded-[14px] border cursor-pointer transition-all text-left",
                                    selectedUserId === debt.userId ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]" : "bg-card border-[color:var(--line)]"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-[var(--accent-tint)] p-[2px]">
                                        <div className="h-full w-full rounded-full bg-card flex items-center justify-center font-bold text-xs overflow-hidden text-primary">
                                            {isAvatarUrl(debt.avatar) ? (
                                                // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                                <img src={debt.avatar} alt={debt.name} className="h-full w-full object-cover" />
                                            ) : (
                                                debt.avatar || "👤"
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-left">
                                        <p className="font-bold text-foreground">{debt.name}</p>
                                        <p className="text-xs text-muted-foreground">Debes <span className="font-mono">{formatEuros(debt.amount)}</span></p>
                                    </div>
                                </div>
                                {selectedUserId === debt.userId && <Check className="text-primary h-5 w-5" />}
                            </button>
                        ))}
                    </div>

                    {selectedUserId && debtorExpenses.length > 0 && (
                        <div className="space-y-3 pt-4">
                            <div className="flex items-center justify-between px-2">
                                <p className="text-sm font-medium text-muted-foreground">Actividad reciente sin pagar:</p>
                                <span className="text-[10px] uppercase bg-secondary px-2 py-0.5 rounded-lg text-muted-foreground font-bold tracking-[0.08em]">Contexto</span>
                            </div>
                            <div className="space-y-2 opacity-75">
                                {debtorExpenses.map((expense: SettleExpense) => (
                                    <div
                                        key={expense.id}
                                        className="flex items-center justify-between p-3 rounded-[14px] border border-[color:var(--line-2)] bg-card"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="text-left">
                                                <p className="text-sm font-bold leading-none mb-1 text-foreground">{expense.description}</p>
                                                <p className="text-[10px] text-[color:var(--ink-3)] uppercase tracking-wider">
                                                    {new Date(expense.date).toLocaleDateString()} • {expense.category}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-mono font-semibold tracking-[-0.02em] text-foreground">{formatEuros(expense.myAmount)}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">de {formatEuros(expense.amount)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-center text-muted-foreground pt-2">
                                Estos gastos son solo informativo. Al pagar, se reduce tu deuda total.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* STEP 2: PAYMENT AMOUNT & METHOD */}
            {step === 2 && selectedDebtor && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">

                    <div className="p-4 rounded-[16px] bg-card border border-[color:var(--line)] flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-[var(--accent-tint)] p-[2px]">
                            <div className="h-full w-full rounded-full bg-card flex items-center justify-center font-bold text-sm overflow-hidden text-primary">
                                {isAvatarUrl(selectedDebtor.avatar) ? (
                                    // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                    <img src={selectedDebtor.avatar} alt={selectedDebtor.name} className="h-full w-full object-cover" />
                                ) : (
                                    selectedDebtor.avatar || "👤"
                                )}
                            </div>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Pagando a</p>
                            <p className="font-bold text-lg text-foreground">{selectedDebtor.name}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="settle-amount" className="text-sm font-medium text-muted-foreground ml-1">Importe</label>
                        <div className="relative">
                            <Input
                                id="settle-amount"
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="text-2xl font-mono font-semibold tracking-[-0.02em] h-14 pl-10"
                                placeholder="0.00"
                            />
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-mono font-semibold text-muted-foreground">€</span>
                        </div>
                        <p className="text-xs text-right text-muted-foreground">Deuda total: <span className="font-mono">{formatEuros(selectedDebtor.amount)}</span></p>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="settle-method-bizum" className="text-sm font-medium text-muted-foreground ml-1">Método</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                id="settle-method-bizum"
                                type="button"
                                onClick={() => setMethod("BIZUM")}
                                className={cn(
                                    "p-4 rounded-[14px] border flex flex-col items-center gap-2 transition-all",
                                    method === "BIZUM" ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]" : "bg-card border-[color:var(--line)] hover:bg-secondary"
                                )}
                            >
                                <Wallet className="h-6 w-6 text-[color:var(--positive)]" />
                                <span className="font-bold text-foreground">Bizum / Transfer</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setMethod("CASH")}
                                className={cn(
                                    "p-4 rounded-[14px] border flex flex-col items-center gap-2 transition-all",
                                    method === "CASH" ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]" : "bg-card border-[color:var(--line)] hover:bg-secondary"
                                )}
                            >
                                <span className="text-2xl">💵</span>
                                <span className="font-bold text-foreground">Efectivo</span>
                            </button>
                        </div>
                    </div>

                </div>
            )}

            {/* FOOTER ACTIONS */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--surface-hex)]/85 backdrop-blur-md border-t border-[color:var(--line)]">
                <div className="max-w-md mx-auto flex gap-2">
                    {step === 1 && (
                        <Button className="w-full" onClick={() => setStep(2)} disabled={!selectedUserId}>
                            Continuar <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                    {step === 2 && (
                        <Button className="w-full" size="lg"
                            disabled={!amount || parseFloat(amount) <= 0 || isSubmitting}
                            isLoading={isSubmitting}
                            onClick={handleSubmit}
                        >
                            Confirmar Pago <Check className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
