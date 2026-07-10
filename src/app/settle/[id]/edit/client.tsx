"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface EditSettleClientProps {
    settlementId: string;
    initialAmount: number;
    initialMethod: "CASH" | "BIZUM" | "TRANSFER";
    toUser: {
        id: string;
        name: string;
        avatar: string;
    };
}

export function EditSettleClient({
    settlementId,
    initialAmount,
    initialMethod,
    toUser
}: EditSettleClientProps) {
    const router = useRouter();
    const [amount, setAmount] = useState<string>(initialAmount.toString());
    const [method, setMethod] = useState<"CASH" | "BIZUM" | "TRANSFER">(initialMethod);
    const [isSubmitting, setIsSubmitting] = useState(false);


    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/settle/${settlementId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    method,
                    amount: parseFloat(amount)
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
                <h1 className="text-lg font-bold text-foreground">Editar Liquidación</h1>
            </header>

            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="p-4 rounded-[16px] bg-[var(--accent-tint)] border border-[color:var(--accent-border)] flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-card flex items-center justify-center text-xl text-primary">
                        {toUser.avatar}
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Pagando a</p>
                        <p className="font-bold text-foreground">{toUser.name}</p>
                    </div>
                </div>

                <div className="text-center py-6 space-y-4">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Importe</p>
                    <div className="flex justify-center items-end gap-2">
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="text-5xl font-mono font-semibold tracking-[-0.02em] text-foreground bg-transparent text-center w-48 outline-none border-b border-[color:var(--line)] focus:border-[color:var(--accent-border)] transition-colors"
                            placeholder="0.00"
                            step="0.01"
                        />
                        <span className="text-3xl font-mono font-semibold text-muted-foreground mb-2">€</span>
                    </div>
                </div>


                <div className="space-y-3">
                    <p className="text-sm font-bold uppercase tracking-widest ml-1 text-muted-foreground">Método de Pago</p>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setMethod("BIZUM")}
                            className={cn(
                                "p-4 rounded-[14px] border flex flex-col items-center gap-2 transition-all",
                                method === "BIZUM" || method === "TRANSFER" ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]" : "bg-card border-[color:var(--line)]"
                            )}
                        >
                            <Wallet className="h-6 w-6 text-[color:var(--positive)]" />
                            <span className="font-bold text-xs text-foreground">Bizum / Transf.</span>
                        </button>
                        <button
                            onClick={() => setMethod("CASH")}
                            className={cn(
                                "p-4 rounded-[14px] border flex flex-col items-center gap-2 transition-all",
                                method === "CASH" ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]" : "bg-card border-[color:var(--line)]"
                            )}
                        >
                            <span className="text-2xl">💵</span>
                            <span className="font-bold text-xs text-foreground">Efectivo</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--surface-hex)]/85 backdrop-blur-md border-t border-[color:var(--line)] z-50">
                <div className="max-w-md mx-auto">
                    <Button
                        className="w-full h-14 text-lg font-bold shadow-[0_12px_28px_-8px_rgba(189,93,58,0.35)]"
                        isLoading={isSubmitting}
                        onClick={handleSubmit}
                        disabled={!amount || parseFloat(amount) <= 0}
                    >
                        Guardar Cambios <Check className="ml-2" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
