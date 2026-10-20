"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EqCta, EqToast, useEqToast } from "@/components/ui/eq";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { formatCurrency } from "@/lib/currency";
import { PendingPaymentSheet } from "@/components/settle/settle-review-sheet";
import { methodPhrase } from "@/components/settle/settle-model";

type Status = "CONFIRMED" | "REJECTED";

/**
 * Confirm / reject a PENDING settlement as its receiver (the creditor). The
 * status route enforces that only the receiver may act; this is just the UI.
 * Both buttons open the review sheet shared with Inicio (CF-08). The amount on
 * screen travels as `expectedAmountCents`: if the payer edited it meanwhile
 * the API answers 409 SETTLEMENT_CHANGED and we reload the detail.
 */
export function SettlementActions({
    id,
    fromName,
    myName,
    amountCents,
    method,
    owedCents,
    balanceCents,
}: {
    id: string;
    fromName: string;
    myName: string;
    amountCents: number;
    method: string;
    /** What the payer owes me in the suggested pairing (cents, before this payment counts). */
    owedCents: number;
    /** My net balance (cents, positive = I'm owed). */
    balanceCents: number;
}) {
    const router = useRouter();
    const { mutate, busy } = useApiMutation();
    const [review, setReview] = useState<Status | null>(null);
    const [sheetError, setSheetError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const open = (status: Status) => {
        setSheetError(null);
        setReview(status);
    };

    async function submit() {
        if (!review) return;
        const res = await mutate(`/api/settle/${id}/status`, {
            method: "PATCH",
            body: { status: review, expectedAmountCents: amountCents },
            errorMessage: review === "CONFIRMED" ? "No se pudo confirmar el pago" : "No se pudo rechazar el pago",
            networkErrorMessage: "Error de conexión",
        });
        if (res.ok) {
            setReview(null);
            setError(null);
        } else if (res.status === 409) {
            // The settlement changed under us (edited/resolved): show the error
            // and refresh so the detail reflects the current state.
            setReview(null);
            setError(res.error);
            router.refresh();
        } else {
            setSheetError(res.error);
        }
    }

    return (
        <div className="flex flex-col gap-3 items-center w-full">
            {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
            <EqCta onClick={() => open("CONFIRMED")} disabled={busy}>
                Sí, he recibido {formatCurrency(amountCents)}
            </EqCta>
            <EqCta variant="outline" onClick={() => open("REJECTED")} disabled={busy} className="text-[color:var(--negative-ink)]">
                No lo he recibido
            </EqCta>
            {review && (
                <PendingPaymentSheet
                    status={review}
                    name={fromName}
                    myName={myName}
                    amountCents={amountCents}
                    method={method}
                    owedCents={owedCents}
                    balanceCents={balanceCents}
                    busy={busy}
                    error={sheetError}
                    onConfirm={submit}
                    onClose={() => setReview(null)}
                />
            )}
        </div>
    );
}

/**
 * Debtor → creditor: "Pedirle que lo confirme" for my PENDING payment (same
 * text as /settle). Native share sheet, else the clipboard plus a toast.
 */
export function AskToConfirmButton({
    id,
    toName,
    amountCents,
    method,
    spaceName,
}: {
    id: string;
    toName: string;
    amountCents: number;
    method: string;
    spaceName: string;
}) {
    const [toast, showToast] = useEqToast();

    async function ask() {
        const text = `¡Hola, ${toName}! Te he pagado ${formatCurrency(amountCents)} ${methodPhrase(method)} en ${spaceName}. ¿Lo confirmas en EQUIL?`;
        const url = `${window.location.origin}/settle/${id}`;
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: "Pago por confirmar en EQUIL", text, url });
                return;
            } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") return;
                // fall through to the clipboard
            }
        }
        try {
            await navigator.clipboard.writeText(`${text} ${url}`);
            showToast("Recordatorio copiado");
        } catch {
            showToast("No se pudo copiar el recordatorio");
        }
    }

    return (
        <>
            <EqCta variant="outline" onClick={ask} data-testid="settlement-ask-confirm">
                Pedirle que lo confirme
            </EqCta>
            {toast && <EqToast>{toast}</EqToast>}
        </>
    );
}
