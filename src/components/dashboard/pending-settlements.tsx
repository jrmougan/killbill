"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { toEuros } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";

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

export function PendingSettlements({ settlements }: PendingSettlementsProps) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [loadingIds, setLoadingIds] = useState<string[]>([]);

    const handleStatusUpdate = async (id: string, newStatus: string) => {
        setLoadingIds(prev => [...prev, id]);
        try {
            const res = await fetch(`/api/settle/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });

            if (res.ok) {
                startTransition(() => router.refresh());
            } else {
                alert("Error al actualizar el estado");
            }
        } catch (e) {
            console.error(e);
            alert("Error de conexión");
        } finally {
            setLoadingIds(prev => prev.filter(x => x !== id));
        }
    };

    if (settlements.length === 0) return null;

    // Compact EQUIL card under the carousel. Copy ("Confirmar Pagos",
    // "X te ha pagado", "50.00€", "Confirmar") is a cross-suite e2e contract.
    return (
        <section aria-labelledby="pending-title" className="eq-in rounded-[18px] bg-[var(--accent-tint)] border border-[color:var(--accent-border)] p-4 flex flex-col gap-3">
            <h2 id="pending-title" className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                Confirmar Pagos
            </h2>

            <ul className="flex flex-col gap-3">
                {settlements.map((s) => (
                    <li key={s.id} className="flex items-center gap-3">
                        <span className="h-10 w-10 flex-none rounded-full bg-card flex items-center justify-center text-lg overflow-hidden text-primary font-bold">
                            {isAvatarUrl(s.fromUser.avatar) ? (
                                // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                <img src={s.fromUser.avatar!} alt="" className="h-full w-full object-cover" />
                            ) : (
                                s.fromUser.avatar || s.fromUser.name.charAt(0).toUpperCase()
                            )}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-semibold truncate">{s.fromUser.name} te ha pagado</p>
                            <p className="text-[12.5px] text-muted-foreground truncate">
                                <span className="tabular-nums font-semibold text-[color:var(--positive)]">{toEuros(s.amount).toFixed(2)}€</span>
                                {" · "}
                                {getSettlementMethodLabel(s.method)}
                                {" · "}
                                {new Date(s.date).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" })}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="h-9 flex-none rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground flex items-center gap-1.5 disabled:opacity-50 active:scale-[0.97]"
                            onClick={() => handleStatusUpdate(s.id, "CONFIRMED")}
                            disabled={loadingIds.length > 0 || refreshing}
                        >
                            <Check className="h-4 w-4" aria-hidden="true" /> Confirmar
                        </button>
                        <button
                            type="button"
                            aria-label={`Rechazar el pago de ${s.fromUser.name}`}
                            className="h-9 w-9 flex-none rounded-xl bg-[var(--negative-tint)] text-destructive flex items-center justify-center disabled:opacity-50 active:scale-[0.97]"
                            onClick={() => handleStatusUpdate(s.id, "REJECTED")}
                            disabled={loadingIds.length > 0 || refreshing}
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
