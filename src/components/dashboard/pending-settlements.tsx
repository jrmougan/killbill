"use client";

import { Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";
import { useApiMutation } from "@/hooks/use-api-mutation";

interface PendingSettlement {
    id: string;
    amount: number;
    fromUser: { name: string; avatar: string | null };
    date: string;
    method: string;
}

interface PendingSettlementsProps {
    settlements: PendingSettlement[];
}

/**
 * "Confirmar Pagos" (Inicio): payments other members say they sent me, waiting
 * for my confirmation. Text gets the full width (it wraps instead of being cut
 * to "User B te …"); the actions sit on their own row with 44px targets.
 */
export function PendingSettlements({ settlements }: PendingSettlementsProps) {
    const { mutate, busy, error } = useApiMutation();

    const handleStatusUpdate = (id: string, newStatus: "CONFIRMED" | "REJECTED", expectedAmountCents: number) =>
        mutate(`/api/settle/${id}/status`, {
            method: "PATCH",
            // expectedAmountCents: confirm exactly the amount on screen (409 if the payer edited it meanwhile).
            body: { status: newStatus, expectedAmountCents },
            errorMessage: newStatus === "CONFIRMED" ? "No se pudo confirmar el pago" : "No se pudo rechazar el pago",
        });

    if (settlements.length === 0) return null;

    // Copy ("Confirmar Pagos", "X te ha pagado", "Confirmar") is an e2e contract.
    return (
        <section aria-labelledby="pending-title" className="eq-in rounded-[18px] bg-[var(--accent-tint)] border border-[color:var(--accent-border)] p-4 flex flex-col gap-3">
            <h2 id="pending-title" className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                Confirmar Pagos
            </h2>

            <ul className="flex flex-col gap-4">
                {settlements.map((s) => {
                    return (
                        <li key={s.id} className="flex flex-col gap-2.5" data-testid="pending-settlement">
                            <div className="flex items-start gap-3">
                                <span className="h-10 w-10 flex-none rounded-full bg-card flex items-center justify-center text-lg overflow-hidden text-primary font-bold" aria-hidden="true">
                                    {isAvatarUrl(s.fromUser.avatar) ? (
                                        // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                        <img src={s.fromUser.avatar!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                    ) : (
                                        s.fromUser.avatar || s.fromUser.name.charAt(0).toUpperCase()
                                    )}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[15px] font-semibold break-words">{s.fromUser.name} te ha pagado</p>
                                    <p className="text-[12.5px] text-muted-foreground">
                                        <span className="font-semibold text-[color:var(--positive)]">{formatCurrency(s.amount)}</span>
                                        {" · "}
                                        {getSettlementMethodLabel(s.method)}
                                        {" · "}
                                        {new Date(s.date).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" }).replace(".", "")}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2 pl-[52px]">
                                <button
                                    type="button"
                                    className="h-11 flex-1 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-[0.97]"
                                    onClick={() => handleStatusUpdate(s.id, "CONFIRMED", s.amount)}
                                    disabled={busy}
                                >
                                    <Check className="h-4 w-4" aria-hidden="true" /> Confirmar
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Rechazar el pago de ${s.fromUser.name}`}
                                    className="h-11 w-11 flex-none rounded-xl bg-[var(--negative-tint)] text-destructive flex items-center justify-center disabled:opacity-50 active:scale-[0.97]"
                                    onClick={() => handleStatusUpdate(s.id, "REJECTED", s.amount)}
                                    disabled={busy}
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {error && (
                <p role="alert" className="text-xs text-destructive">{error}</p>
            )}
        </section>
    );
}
