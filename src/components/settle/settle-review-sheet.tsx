"use client";

import { useState } from "react";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { formatCurrency } from "@/lib/currency";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";
import { settleAmountText, validateSettleAmount } from "@/components/settle/settle-amount";
import type { SettleMethod } from "@/components/settle/settle-model";

/** "EQUIL no envía dinero: …" — what the debtor has to do outside the app first. */
const SEND_FIRST: Record<SettleMethod, string> = {
    BIZUM: "haz primero el Bizum desde tu banco",
    TRANSFER: "haz primero la transferencia desde tu banco",
    CASH: "dale primero el dinero en efectivo",
};

/**
 * Review step before /settle records a payment (docs/ux/plan-acciones-criticas.md
 * §3, CF-10). `direction="pay"`: I paid `name` (PENDING until they confirm);
 * `"receive"`: `name` paid me (CONFIRMED at once, no undo). The amount starts
 * at the whole transfer and can be lowered for a partial payment, never above
 * `maxCents`: an invalid amount is an inline error and the CTA stays disabled,
 * so nothing reaches the API.
 */
export function RecordSettlementSheet({
    direction,
    name,
    maxCents,
    method,
    busy,
    error,
    onConfirm,
    onClose,
}: {
    direction: "pay" | "receive";
    /** The other member. */
    name: string;
    /** The whole transfer (cents): prefilled and the cap. */
    maxCents: number;
    method: SettleMethod;
    busy: boolean;
    error: string | null;
    onConfirm: (cents: number) => void;
    onClose: () => void;
}) {
    const [text, setText] = useState(() => settleAmountText(maxCents));
    const check = validateSettleAmount(text, maxCents);
    const cents = check.cents;
    const amount = formatCurrency(cents ?? maxCents);
    const rest = cents !== null && cents < maxCents ? formatCurrency(maxCents - cents) : null;
    const pay = direction === "pay";

    const field = (
        <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-1">
                <input
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Importe"
                    aria-invalid={!!check.error}
                    aria-describedby={check.error ? "settle-review-amount-error" : "settle-review-amount-max"}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={busy}
                    data-testid="settle-review-amount"
                    className="h-11 w-[7.5rem] rounded-[12px] border border-[color:var(--line)] bg-card px-3 text-right text-[17px] font-bold tabular-nums outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span aria-hidden="true">€</span>
            </span>
            {check.error ? (
                <span id="settle-review-amount-error" role="alert" data-testid="settle-review-amount-error" className="text-[13px] font-normal text-destructive text-right">
                    {check.error}
                </span>
            ) : (
                <span id="settle-review-amount-max" className="text-[13px] font-normal text-muted-foreground">
                    máx. {formatCurrency(maxCents)}
                </span>
            )}
        </div>
    );
    const facts = [
        { label: "De → Para", value: pay ? `Tú → ${name}` : `${name} → Tú` },
        { label: "Importe", value: field, emphasis: true },
        { label: "Método", value: getSettlementMethodLabel(method) },
    ];

    if (pay) {
        return (
            <CriticalActionSheet
                testId="settle-review-sheet"
                title="Antes de marcarlo como pagado"
                facts={facts}
                consequences={[
                    ...(rest ? [`Te quedará por pagar ${rest}.`] : []),
                    `EQUIL no envía dinero: ${SEND_FIRST[method]}.`,
                    `Avisaremos a ${name}.`,
                    `Contará cuando ${name} confirme que lo ha recibido.`,
                ]}
                confirmLabel={`Sí, ya le he pagado ${amount}`}
                confirmDisabled={cents === null}
                cancelLabel="Todavía no"
                busy={busy}
                error={error}
                errorHref={null}
                onConfirm={() => cents !== null && onConfirm(cents)}
                onClose={onClose}
            />
        );
    }
    return (
        <CriticalActionSheet
            testId="settle-review-sheet"
            title={`¿Has recibido ${amount} de ${name}?`}
            facts={facts}
            consequences={[
                ...(rest ? [`${name} aún te deberá ${rest}.`] : []),
                method === "CASH"
                    ? "Se dará por saldado al momento. Márcalo solo si ya tienes el dinero."
                    : "Se dará por saldado al momento. Márcalo solo si el dinero ya está en tu cuenta.",
            ]}
            reversible={false}
            confirmLabel="Sí, lo he recibido"
            confirmDisabled={cents === null}
            busy={busy}
            error={error}
            errorHref={null}
            onConfirm={() => cents !== null && onConfirm(cents)}
            onClose={onClose}
        />
    );
}

/**
 * Answer to a PENDING payment someone says they sent me (Inicio "Pagos por
 * confirmar" and the incoming CTA of /settle): confirm it as received or
 * reject it. `owedCents` is what the payer owes me before it counts.
 */
export function PendingPaymentSheet({
    status,
    name,
    myName,
    amountCents,
    method,
    owedCents,
    busy,
    error,
    onConfirm,
    onClose,
}: {
    status: "CONFIRMED" | "REJECTED";
    /** The payer. */
    name: string;
    myName: string;
    amountCents: number;
    method: string;
    owedCents: number;
    busy: boolean;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const amount = formatCurrency(amountCents);
    if (status === "REJECTED") {
        return (
            <CriticalActionSheet
                testId="reject-settlement-sheet"
                tone="danger"
                title={`¿No has recibido el pago de ${name}?`}
                facts={[
                    { label: "De", value: name },
                    { label: "Importe", value: amount, emphasis: true },
                    { label: "Método", value: getSettlementMethodLabel(method) },
                ]}
                consequences={[`La deuda de ${amount} seguirá pendiente y ${name} verá que no lo has recibido. Podrá registrarlo de nuevo.`]}
                confirmLabel="Rechazar el pago"
                busy={busy}
                error={error}
                errorHref={null}
                onConfirm={onConfirm}
                onClose={onClose}
            />
        );
    }
    const rest = Math.max(0, owedCents - amountCents);
    return (
        <CriticalActionSheet
            testId="confirm-settlement-sheet"
            title={`¿Has recibido ${amount} de ${name}?`}
            facts={[
                { label: "De", value: name },
                { label: "Para", value: `${myName} (tú)` },
                { label: "Importe", value: amount, emphasis: true },
                { label: "Método", value: getSettlementMethodLabel(method) },
            ]}
            consequences={[rest > 0 ? `${name} aún te deberá ${formatCurrency(rest)}.` : `${name} dejará de deberte ${amount}.`]}
            reversible={false}
            confirmLabel={`Sí, he recibido ${amount}`}
            busy={busy}
            error={error}
            errorHref={null}
            onConfirm={onConfirm}
            onClose={onClose}
        />
    );
}
