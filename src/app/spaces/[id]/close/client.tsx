"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Archive, CircleDollarSign, AlertCircle, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/currency";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

type Debt = { userId: string; name: string; amountCents: number };
type SettlementRow = { id: string; fromName: string; toName: string; amountCents: number; status: string };

/**
 * Guided close flow for a space (Fase 1): pairwise summary of what the caller
 * owes, a "start settling" action (POST /api/spaces/[id]/settle-up → SETTLING +
 * suggested PENDING settlements), a checklist of settlements with progress, and
 * the final "Archive" step (PATCH → ARCHIVED).
 */
export function CloseSpaceClient({
    spaceId,
    spaceName,
    type,
    status,
    expiresAt,
    myDebts,
    settlements,
    canManage,
}: {
    spaceId: string;
    spaceName: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    /** ISO string; the EPHEMERAL close SUGGESTION date (never auto-enforced). */
    expiresAt?: string | null;
    myDebts: Debt[];
    settlements: SettlementRow[];
    canManage: boolean;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // EPHEMERAL close countdown — a soft suggestion to the organizer, never a
    // hard deadline (there is no auto-archive cron in v1).
    const days =
        type === SpaceType.EPHEMERAL && status === SpaceStatus.ACTIVE ? daysUntil(expiresAt) : null;
    const countdownLabel =
        days === null ? null :
        days < 0 ? "La fecha sugerida de cierre ya pasó" :
        days === 0 ? "El viaje termina hoy" :
        days === 1 ? "Queda 1 día sugerido para cerrar" :
        `Quedan ${days} días sugeridos para cerrar`;

    const totalOwed = myDebts.reduce((acc, d) => acc + d.amountCents, 0);
    const confirmed = settlements.filter((s) => s.status === "CONFIRMED").length;
    const total = settlements.length;
    const allConfirmed = total > 0 && confirmed === total;

    const startSettling = async () => {
        setBusy("settle");
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/settle-up`, { method: "POST" });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                router.refresh();
            } else {
                setError(data?.error || "No se pudo iniciar la liquidación");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setBusy(null);
        }
    };

    const archive = async () => {
        if (!confirm("¿Archivar el espacio? Quedará en solo lectura como recuerdo. No se puede reabrir.")) return;
        setBusy("archive");
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: SpaceStatus.ARCHIVED }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            } else {
                setError(data?.error || "No se pudo archivar");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-3 pt-2">
                <Link href={`/spaces/${spaceId}`}>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="min-w-0">
                    <h1 className="text-lg font-bold text-foreground truncate">Cerrar {spaceName}</h1>
                    <p className="text-[12px] text-muted-foreground">Liquidad las cuentas y archivad el espacio.</p>
                </div>
            </header>

            {/* Soft close countdown for an ephemeral trip (suggestion only). */}
            {countdownLabel && (
                <div className="flex items-center gap-3 rounded-2xl bg-secondary border border-[color:var(--line)] px-4 py-3">
                    <Hourglass className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground">{countdownLabel}</p>
                        <p className="text-[12px] text-muted-foreground">Es solo una sugerencia; cerrad cuando queráis.</p>
                    </div>
                </div>
            )}

            {/* What I owe */}
            <section className="space-y-3">
                <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground px-1">Lo que debes</h2>
                {myDebts.length === 0 ? (
                    <div className="rounded-2xl bg-[var(--positive-tint)] border border-[color:var(--positive)]/30 px-4 py-4 text-center">
                        <p className="text-sm font-semibold text-foreground">Estás al día ✓</p>
                        <p className="text-[12px] text-muted-foreground">No debes nada a nadie en este espacio.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {myDebts.map((d) => (
                            <div
                                key={d.userId}
                                className="flex items-center justify-between rounded-xl bg-card border border-[color:var(--line-2)] px-3 py-2.5"
                            >
                                <span className="text-sm text-foreground">Debes a {d.name}</span>
                                <span className="font-mono font-semibold text-destructive">
                                    {formatEuros(d.amountCents / 100)}
                                </span>
                            </div>
                        ))}
                        <div className="flex items-center justify-between px-1 pt-1 text-sm">
                            <span className="text-muted-foreground">Total</span>
                            <span className="font-mono font-bold text-foreground">{formatEuros(totalOwed / 100)}</span>
                        </div>
                    </div>
                )}
            </section>

            {/* Settlement checklist */}
            {total > 0 && (
                <section className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                        <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">Liquidaciones</h2>
                        <span className="text-[12px] text-muted-foreground">{confirmed}/{total} confirmadas</span>
                    </div>
                    <div className="space-y-2">
                        {settlements.map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center gap-3 rounded-xl bg-card border border-[color:var(--line-2)] px-3 py-2.5"
                            >
                                <span
                                    className={cn(
                                        "h-6 w-6 rounded-full flex items-center justify-center shrink-0",
                                        s.status === "CONFIRMED"
                                            ? "bg-[var(--positive-tint)] text-[color:var(--positive)]"
                                            : "bg-secondary text-muted-foreground",
                                    )}
                                >
                                    {s.status === "CONFIRMED" ? <Check className="h-3.5 w-3.5" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
                                </span>
                                <span className="flex-1 min-w-0 text-sm text-foreground truncate">
                                    {s.fromName} → {s.toName}
                                </span>
                                <span className="font-mono text-sm font-semibold text-foreground shrink-0">
                                    {formatEuros(s.amountCents / 100)}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {error && (
                <p className="flex items-center gap-1.5 text-xs text-destructive px-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </p>
            )}

            {/* Actions */}
            {canManage && (
                <div className="space-y-3">
                    {status === SpaceStatus.ACTIVE && (
                        <Button className="w-full h-12" onClick={startSettling} isLoading={busy === "settle"}>
                            <CircleDollarSign className="h-4 w-4 mr-2" /> Iniciar liquidación
                        </Button>
                    )}
                    {status !== SpaceStatus.ARCHIVED && (
                        <Button
                            variant="secondary"
                            className={cn("w-full h-12", allConfirmed && "border-[color:var(--positive)]/40")}
                            onClick={archive}
                            isLoading={busy === "archive"}
                        >
                            <Archive className="h-4 w-4 mr-2" /> Archivar espacio
                        </Button>
                    )}
                    {status === SpaceStatus.ACTIVE && (
                        <p className="text-[11px] text-center text-muted-foreground">
                            Al iniciar, el espacio pasa a &quot;Liquidando&quot;: no se pueden crear gastos nuevos.
                        </p>
                    )}
                </div>
            )}

            <Link href="/settle" className="block">
                <Button variant="ghost" className="w-full h-11 text-muted-foreground">
                    Ir a liquidar deudas
                </Button>
            </Link>
        </div>
    );
}
