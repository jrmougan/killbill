"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EqCta, EqHeader } from "@/components/ui/eq";
import { MethodPicker } from "@/components/settle/method-picker";
import type { SettleMethod } from "@/components/settle/settle-model";
import { parseEuroInput } from "@/lib/currency";
import { MAX_SETTLEMENT_CENTS } from "@/lib/settlement-rules";

interface EditSettleClientProps {
    settlementId: string;
    /** Current amount in cents. */
    initialCents: number;
    initialMethod: SettleMethod;
    toName: string;
}

/** Strict es-ES amount → cents, or an error message for the field. */
function validate(text: string): { cents: number | null; error: string | null } {
    if (!text.trim()) return { cents: null, error: "Escribe un importe" };
    const cents = parseEuroInput(text);
    if (cents === null) return { cents: null, error: "Importe no válido. Usa, por ejemplo, 12,50" };
    if (cents < 1) return { cents: null, error: "El importe debe ser de al menos 0,01 €" };
    if (cents > MAX_SETTLEMENT_CENTS) return { cents: null, error: "El importe no puede superar 1.000.000 €" };
    return { cents, error: null };
}

export function EditSettleClient({ settlementId, initialCents, initialMethod, toName }: EditSettleClientProps) {
    const router = useRouter();
    const [amount, setAmount] = useState<string>((initialCents / 100).toFixed(2).replace(".", ","));
    const [method, setMethod] = useState<SettleMethod>(initialMethod);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [touched, setTouched] = useState(false);
    const check = validate(amount);
    const valid = check.cents !== null;
    const fieldError = touched ? check.error : null;

    const handleSubmit = async () => {
        setTouched(true);
        if (check.cents === null) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/settle/${settlementId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method, amount: check.cents / 100 }),
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
        <main className="eq-in min-h-dvh w-full max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)]">
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
                            onChange={(e) => { setAmount(e.target.value); setTouched(true); }}
                            onBlur={() => setTouched(true)}
                            aria-invalid={!!fieldError}
                            aria-describedby={fieldError ? "settle-amount-error" : undefined}
                            className="w-[200px] bg-transparent text-center text-[44px] font-bold tracking-[-0.03em] tabular-nums outline-none border-b border-[color:var(--line)] focus:border-primary transition-colors"
                            placeholder="0,00"
                        />
                        <span className="text-[28px] font-bold text-muted-foreground">€</span>
                    </div>
                    {fieldError && (
                        <p id="settle-amount-error" role="alert" className="text-[13px] text-destructive" data-testid="settle-amount-error">{fieldError}</p>
                    )}
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
