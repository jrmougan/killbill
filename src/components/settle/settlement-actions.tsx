"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EqCta } from "@/components/ui/eq";

/**
 * Confirm / reject a PENDING settlement as its receiver (the creditor). The
 * status route enforces that only the receiver may act; this is just the UI.
 * The amount on screen travels as `expectedAmountCents`: if the payer edited it
 * meanwhile the API answers 409 SETTLEMENT_CHANGED and we reload the detail.
 */
export function SettlementActions({ id, fromName, amountCents }: { id: string; fromName: string; amountCents: number }) {
    const router = useRouter();
    const [busy, setBusy] = useState<"CONFIRMED" | "REJECTED" | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function act(status: "CONFIRMED" | "REJECTED") {
        if (status === "REJECTED" && !window.confirm(`¿Rechazar el pago de ${fromName}? No contará en el saldo.`)) return;
        setBusy(status);
        setError(null);
        try {
            const res = await fetch(`/api/settle/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status, expectedAmountCents: amountCents }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                // The settlement changed under us (edited/resolved): show the error
                // and refresh so the detail reflects the current state.
                if (res.status === 409) router.refresh();
                throw new Error(json.error || "No se pudo actualizar el pago");
            }
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error de conexión");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-3 items-center w-full">
            {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
            <EqCta onClick={() => act("CONFIRMED")} disabled={busy !== null} aria-busy={busy === "CONFIRMED"}>
                Confirmar, lo he recibido
            </EqCta>
            <EqCta variant="outline" onClick={() => act("REJECTED")} disabled={busy !== null} aria-busy={busy === "REJECTED"} className="text-[color:var(--negative)]">
                Rechazar
            </EqCta>
        </div>
    );
}
