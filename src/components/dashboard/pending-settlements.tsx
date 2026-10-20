"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { PendingPaymentSheet } from "@/components/settle/settle-review-sheet";
import { incomingOutcome } from "@/components/settle/settle-model";
import { EqToast, useEqToast } from "@/components/ui/eq";

interface PendingSettlement {
    id: string;
    amount: number;
    fromUser: { name: string; avatar: string | null };
    date: string;
    method: string;
    /** What the payer really owes (`debtOf`, cents, before this payment counts). */
    owedCents: number;
}

interface PendingSettlementsProps {
    settlements: PendingSettlement[];
    /** The space is SETTLING: these confirmations are what closes it. */
    settling?: boolean;
    myName: string;
    /** My net balance in the space (cents, positive = I'm owed). */
    balanceCents: number;
}

type Review = { s: PendingSettlement; status: "CONFIRMED" | "REJECTED" };

const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" }).replace(".", "");

/**
 * "Pagos por confirmar" (Inicio): payments other members say they sent me.
 * Both buttons open a review sheet (CriticalActionSheet) before the PATCH;
 * the toast tells what is left of the debt. A 409 (edited or already
 * answered meanwhile) refreshes and shows the error on that row. The card
 * stays mounted while empty so the success toast survives the refresh.
 */
export function PendingSettlements({ settlements, settling = false, myName, balanceCents }: PendingSettlementsProps) {
    const router = useRouter();
    const { mutate, busy } = useApiMutation();
    const [review, setReview] = useState<Review | null>(null);
    const [sheetError, setSheetError] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [toast, showToast] = useEqToast(3500);

    const open = (s: PendingSettlement, status: Review["status"]) => {
        setSheetError(null);
        setReview({ s, status });
    };

    const submit = async () => {
        if (!review) return;
        const { s, status } = review;
        const name = s.fromUser.name;
        const result = await mutate(`/api/settle/${s.id}/status`, {
            method: "PATCH",
            // expectedAmountCents: confirm exactly the amount on screen (409 if the payer edited it meanwhile).
            body: { status, expectedAmountCents: s.amount },
            errorMessage: status === "CONFIRMED" ? "No se pudo confirmar el pago" : "No se pudo rechazar el pago",
        });
        if (result.ok) {
            setReview(null);
            setRowErrors(({ [s.id]: _, ...rest }) => rest);
            const outcome = incomingOutcome(balanceCents, s.owedCents, s.amount);
            showToast(
                status === "REJECTED"
                    ? `Pago rechazado: la deuda con ${name} sigue pendiente`
                    : outcome.kind === "settled"
                        ? `Deuda saldada: ${name} ya no te debe nada`
                        : outcome.kind === "payer"
                            ? `Pago confirmado · ${name} aún te debe ${formatCurrency(outcome.rest)}`
                            : `Pago confirmado · aún te deben ${formatCurrency(outcome.rest)} en total`,
            );
        } else if (result.status === 409) {
            // The payment changed or was already answered: show the fresh state.
            setReview(null);
            setRowErrors((e) => ({ ...e, [s.id]: result.error }));
            router.refresh();
        } else {
            setSheetError(result.error);
        }
    };

    // A 409 on a payment that the refresh removed (already answered): keep the message visible.
    const orphanErrors = Object.entries(rowErrors).filter(([id]) => !settlements.some((s) => s.id === id));

    return (
        <>
            {orphanErrors.map(([id, msg]) => (
                <p key={id} role="alert" className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm text-[color:var(--negative-ink)]">{msg}</p>
            ))}
            {settlements.length > 0 && (
                <section aria-labelledby="pending-title" className="eq-in rounded-[18px] bg-[var(--accent-tint)] border border-[color:var(--accent-border)] p-4 flex flex-col gap-3">
                    <div>
                        <h2 id="pending-title" className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                            <span className="relative flex h-2 w-2" aria-hidden="true">
                                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                            </span>
                            Pagos por confirmar · {settlements.length}
                        </h2>
                        {settling && (
                            <p className="mt-1 text-[13px] font-semibold text-foreground">Confirma los pagos para cerrar las cuentas</p>
                        )}
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                            Hasta que confirmes que los has recibido, la deuda sigue pendiente.
                        </p>
                    </div>

                    <ul className="flex flex-col gap-4">
                        {settlements.map((s) => {
                            const rowBusy = busy && review?.s.id === s.id;
                            return (
                                <li key={s.id} className="flex flex-col gap-2.5" data-testid="pending-settlement" aria-busy={rowBusy || undefined}>
                                    <Link href={`/settle/${s.id}`} className="flex items-start gap-3 rounded-xl min-h-11">
                                        <span className="h-10 w-10 flex-none rounded-full bg-card flex items-center justify-center text-lg overflow-hidden text-primary font-bold" aria-hidden="true">
                                            {isAvatarUrl(s.fromUser.avatar) ? (
                                                // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                                <img src={s.fromUser.avatar!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                            ) : (
                                                s.fromUser.avatar || s.fromUser.name.charAt(0).toUpperCase()
                                            )}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[15px] font-semibold break-words">{s.fromUser.name} dice que te ha pagado</span>
                                            <span className="block text-[12.5px] text-muted-foreground">
                                                <span className="font-semibold text-foreground">{formatCurrency(s.amount)}</span>
                                                {" · "}
                                                {getSettlementMethodLabel(s.method)}
                                                {" · "}
                                                {shortDate(s.date)}
                                            </span>
                                        </span>
                                    </Link>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className="h-11 flex-1 whitespace-nowrap rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground flex items-center justify-center disabled:opacity-50 active:scale-[0.97]"
                                            onClick={() => open(s, "CONFIRMED")}
                                            disabled={busy}
                                        >
                                            Lo he recibido
                                        </button>
                                        <button
                                            type="button"
                                            className="h-11 flex-none whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-[color:var(--negative-ink)] flex items-center justify-center disabled:opacity-50 active:scale-[0.97]"
                                            onClick={() => open(s, "REJECTED")}
                                            disabled={busy}
                                        >
                                            No lo he recibido
                                        </button>
                                    </div>
                                    {rowErrors[s.id] && (
                                        <p role="alert" className="text-xs text-[color:var(--negative-ink)]">{rowErrors[s.id]}</p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {review && (
                <PendingPaymentSheet
                    status={review.status}
                    name={review.s.fromUser.name}
                    myName={myName}
                    amountCents={review.s.amount}
                    method={review.s.method}
                    owedCents={review.s.owedCents}
                    balanceCents={balanceCents}
                    busy={busy}
                    error={sheetError}
                    onConfirm={submit}
                    onClose={() => setReview(null)}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </>
    );
}
