"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Wallet, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface Debtor {
    userId: string;
    name: string;
    avatar: string;
    amount: number;
}

interface SettleClientProps {
    debts: Debtor[];
}

export function SettleClient({ debts }: SettleClientProps) {
    const router = useRouter();
    const [step, setStep] = useState<1 | 2>(1);

    // Step 1: User
    const [selectedUserId, setSelectedUserId] = useState<string | null>(debts.length > 0 ? debts[0].userId : null);

    // Step 2: Payment
    const [amount, setAmount] = useState<string>("");
    const [method, setMethod] = useState<"CASH" | "BIZUM">("BIZUM");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectedDebtor = debts.find(d => d.userId === selectedUserId);

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
                    method
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
                    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setStep(1)}><ArrowLeft /></Button>
                )}
                <h1 className="text-lg font-bold">
                    {step === 1 && "Liquidar Deuda"}
                    {step === 2 && "Realizar Pago"}
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
                                    setAmount(debt.amount.toFixed(2));
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

            {/* STEP 2: PAYMENT AMOUNT & METHOD */}
            {step === 2 && selectedDebtor && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">

                    <div className="p-4 rounded-xl bg-card border border-white/10 flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-primary to-purple-500 p-[2px]">
                            <div className="h-full w-full rounded-full bg-black flex items-center justify-center font-bold text-sm overflow-hidden">
                                {selectedDebtor.avatar}
                            </div>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Pagando a</p>
                            <p className="font-bold text-lg">{selectedDebtor.name}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground ml-1">Importe</label>
                        <div className="relative">
                            <Input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="text-2xl font-bold h-14 pl-10"
                                placeholder="0.00"
                            />
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">€</span>
                        </div>
                        <p className="text-xs text-right text-muted-foreground">Deuda total: {selectedDebtor.amount.toFixed(2)}€</p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground ml-1">Método</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setMethod("BIZUM")}
                                className={cn(
                                    "p-4 rounded-xl border flex flex-col items-center gap-2 transition-all",
                                    method === "BIZUM" ? "bg-primary/20 border-primary shadow-lg shadow-primary/10" : "bg-card border-white/10 hover:bg-white/5"
                                )}
                            >
                                <Wallet className="h-6 w-6 text-emerald-400" />
                                <span className="font-bold">Bizum / Transfer</span>
                            </button>
                            <button
                                onClick={() => setMethod("CASH")}
                                className={cn(
                                    "p-4 rounded-xl border flex flex-col items-center gap-2 transition-all",
                                    method === "CASH" ? "bg-primary/20 border-primary shadow-lg shadow-primary/10" : "bg-card border-white/10 hover:bg-white/5"
                                )}
                            >
                                <span className="text-2xl">💵</span>
                                <span className="font-bold">Efectivo</span>
                            </button>
                        </div>
                    </div>

                </div>
            )}

            {/* FOOTER ACTIONS */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-md border-t border-white/10">
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
