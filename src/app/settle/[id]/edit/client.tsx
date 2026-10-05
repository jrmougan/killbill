"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EqCta, EqHeader } from "@/components/ui/eq";
import { MethodPicker } from "@/components/settle/method-picker";
import type { SettleMethod } from "@/components/settle/settle-model";
import { parseAmountInput } from "@/lib/currency";

interface EditSettleClientProps {
    settlementId: string;
    initialAmount: number;
    initialMethod: SettleMethod;
    toName: string;
}

export function EditSettleClient({ settlementId, initialAmount, initialMethod, toName }: EditSettleClientProps) {
    const router = useRouter();
    const [amount, setAmount] = useState<string>(initialAmount.toFixed(2).replace(".", ","));
    const [method, setMethod] = useState<SettleMethod>(initialMethod);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const numeric = parseAmountInput(amount);
    const valid = numeric > 0;

    const handleSubmit = async () => {
        if (!valid) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/settle/${settlementId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method, amount: numeric }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || "No se pudo guardar el pago");
            }
            router.push(`/settle/${settlementId}`);
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error de conexión");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="eq-in min-h-dvh max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)]">
            <EqHeader back={`/settle/${settlementId}`} close title="Editar pago" />

            <div className="flex-1 flex flex-col gap-8 px-5 pt-8">
                <div className="flex flex-col items-center gap-2 text-center">
                    <label htmlFor="settle-amount" className="text-[15px] text-muted-foreground">
                        Importe pagado a {toName}
                    </label>
                    <div className="flex items-baseline justify-center gap-1">
                        <input
                            id="settle-amount"
                            inputMode="decimal"
                            autoComplete="off"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            aria-invalid={!valid}
                            className="w-[200px] bg-transparent text-center text-[44px] font-bold tracking-[-0.03em] tabular-nums outline-none border-b border-[color:var(--line)] focus:border-primary transition-colors"
                            placeholder="0,00"
                        />
                        <span className="text-[28px] font-bold text-muted-foreground">€</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground">Seguirá pendiente hasta que {toName} lo confirme.</p>
                </div>

                <MethodPicker value={method} onChange={setMethod} label="Método" />
            </div>

            <div className="px-5 pb-[max(env(safe-area-inset-bottom),30px)] pt-6 flex flex-col gap-3">
                {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
                <EqCta onClick={handleSubmit} disabled={!valid || submitting} aria-busy={submitting}>
                    Guardar cambios
                </EqCta>
            </div>
        </main>
    );
}
