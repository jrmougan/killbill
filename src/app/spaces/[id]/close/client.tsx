"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Archive, CircleDollarSign, AlertCircle, Hourglass, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

type Debt = { userId: string; name: string; amountCents: number };
type SettlementRow = { id: string; fromName: string; toName: string; amountCents: number; status: string };

/**
 * Guided close flow for a space: what the caller owes, "Iniciar liquidación"
 * (POST /api/spaces/[id]/settle-up → SETTLING + suggested PENDING settlements),
 * the settlement checklist with progress, a link to settle THIS space
 * (`/settle?space=<id>`, not the active-space cookie) and the final "Archivar"
 * (PATCH → ARCHIVED). Archiving is refused by the API while balances are open or
 * payments are pending; the 409 message and its settle link are shown inline.
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
    settleHref,
    canArchive,
}: {
    spaceId: string;
    spaceName: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    /** ISO string; the EPHEMERAL trip end (caps guest access, never closes the space). */
    expiresAt?: string | null;
    myDebts: Debt[];
    settlements: SettlementRow[];
    canManage: boolean;
    settleHref: string;
    /** Everyone at peace and nothing PENDING (the API re-checks). */
    canArchive: boolean;
}) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<{ message: string; href: string | null } | null>(null);

    const days = type === SpaceType.EPHEMERAL && status === SpaceStatus.ACTIVE ? daysUntil(expiresAt) : null;
    const countdownLabel =
        days === null ? null :
        days < 0 ? "El viaje ya terminó" :
        days <= 1 ? "El viaje termina hoy" :
        `Quedan ${days} días de viaje`;

    const totalOwed = myDebts.reduce((acc, d) => acc + d.amountCents, 0);
    const visible = settlements.filter((s) => s.status !== "REJECTED");
    const confirmed = visible.filter((s) => s.status === "CONFIRMED").length;
    const total = visible.length;

    const startSettling = async () => {
        setBusy("settle");
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/settle-up`, { method: "POST" });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                startTransition(() => router.refresh());
            } else {
                setError({ message: data?.error || "No se pudo iniciar la liquidación", href: null });
            }
        } catch {
            setError({ message: "Sin conexión. Inténtalo de nuevo.", href: null });
        } finally {
            setBusy(null);
        }
    };

    const archive = async () => {
        if (!confirm("¿Archivar el espacio? Quedará en solo lectura como recuerdo y no se podrá reabrir.")) return;
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
                startTransition(() => {
                    router.push("/dashboard");
                    router.refresh();
                });
            } else {
                setError({ message: data?.error || "No se pudo archivar", href: data?.settleUrl ?? null });
            }
        } catch {
            setError({ message: "Sin conexión. Inténtalo de nuevo.", href: null });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="min-h-screen pb-28 eq-in">
            <header className="px-5 pt-3 flex items-center">
                <Link href={`/spaces/${spaceId}`} aria-label="Volver al espacio" className="-ml-2.5 h-11 w-11 flex items-center justify-center">
                    <ArrowLeft className="h-6 w-6" aria-hidden="true" />
                </Link>
            </header>
            <div className="px-5 pt-1 flex flex-col gap-1">
                <h1 className="text-2xl font-bold tracking-[-0.02em] break-words">Cerrar {spaceName}</h1>
                <p className="text-[15px] text-muted-foreground">Quedad en paz y archivad el espacio como recuerdo.</p>
            </div>

            <div className="px-5 pt-5 flex flex-col gap-6">
                {countdownLabel && (
                    <div className="flex items-start gap-3 rounded-2xl bg-[var(--track)] px-4 py-3">
                        <Hourglass className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold">{countdownLabel}</p>
                            <p className="text-[12px] text-muted-foreground">
                                Los invitados pueden entrar hasta el final de ese día. El espacio no se cierra solo.
                            </p>
                        </div>
                    </div>
                )}

                <section aria-labelledby="owe-title" className="flex flex-col gap-2">
                    <h2 id="owe-title" className="text-xs font-semibold text-muted-foreground">Lo que debes</h2>
                    {myDebts.length === 0 ? (
                        <div data-testid="close-no-debts" className="rounded-[18px] bg-[var(--positive-tint)] px-4 py-4 text-center">
                            <p className="text-[15px] font-semibold">Estás al día ✓</p>
                            <p className="text-[13px] text-muted-foreground">No debes nada a nadie en este espacio.</p>
                        </div>
                    ) : (
                        <div className="rounded-[18px] bg-card border border-[color:var(--line-2)] px-4 divide-y divide-[color:var(--line-2)]">
                            {myDebts.map((d) => (
                                <div key={d.userId} data-testid="close-debt-row" className="flex items-center justify-between py-3">
                                    <span className="text-[15px]">Debes a {d.name}</span>
                                    <span data-testid="close-amount" className="font-semibold tabular-nums text-[color:var(--negative)]">{formatCurrency(d.amountCents)}</span>
                                </div>
                            ))}
                            {myDebts.length > 1 && (
                                <div className="flex items-center justify-between py-3 text-[15px]">
                                    <span className="text-muted-foreground">Total</span>
                                    <span className="font-bold tabular-nums">{formatCurrency(totalOwed)}</span>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {total > 0 && (
                    <section aria-labelledby="settlements-title" className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <h2 id="settlements-title" className="text-xs font-semibold text-muted-foreground">Liquidaciones</h2>
                            <span data-testid="close-progress" className="text-xs text-muted-foreground">{confirmed}/{total} confirmadas</span>
                        </div>
                        <div className="rounded-[18px] bg-card border border-[color:var(--line-2)] px-4 divide-y divide-[color:var(--line-2)]">
                            {visible.map((s) => (
                                <div key={s.id} data-testid="close-settlement-row" data-status={s.status} className="flex items-center gap-3 py-3">
                                    <span
                                        className={cn(
                                            "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                                            s.status === "CONFIRMED" ? "bg-[var(--positive-tint)] text-[color:var(--positive)]" : "bg-[var(--track)] text-muted-foreground",
                                        )}
                                        aria-hidden="true"
                                    >
                                        {s.status === "CONFIRMED" ? <Check className="h-3.5 w-3.5" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[15px] truncate">{s.fromName} → {s.toName}</span>
                                        <span className="block text-[12.5px] text-muted-foreground">{s.status === "CONFIRMED" ? "Confirmado" : "Pendiente de confirmar"}</span>
                                    </span>
                                    <span data-testid="close-amount" className="text-[15px] font-semibold tabular-nums shrink-0">{formatCurrency(s.amountCents)}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {error && (
                    <div role="alert" data-testid="close-error" className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm">
                        <p className="flex items-start gap-1.5">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" /> {error.message}
                        </p>
                        {error.href && (
                            <Link href={error.href} className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary">
                                Ir a liquidar →
                            </Link>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    {status !== SpaceStatus.ARCHIVED && (
                        <Link
                            href={settleHref}
                            data-testid="close-go-settle"
                            className={cn(
                                "w-full h-14 rounded-[18px] text-base font-semibold flex items-center justify-center",
                                status === SpaceStatus.SETTLING ? "bg-primary text-primary-foreground" : "bg-card border border-[color:var(--line)]",
                            )}
                        >
                            Ir a liquidar deudas
                        </Link>
                    )}
                    {canManage && status === SpaceStatus.ACTIVE && (
                        <>
                            <button
                                type="button"
                                className="w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                                onClick={startSettling}
                                disabled={busy !== null || refreshing}
                                data-testid="close-start-settling"
                            >
                                {busy === "settle" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
                                Iniciar liquidación
                            </button>
                            <p className="text-xs text-center text-muted-foreground -mt-1">
                                El espacio pasa a &quot;Liquidando&quot;: no se pueden crear gastos nuevos.
                            </p>
                        </>
                    )}
                    {canManage && status !== SpaceStatus.ARCHIVED && (
                        <>
                            <button
                                type="button"
                                className="w-full h-14 rounded-[18px] bg-card border border-[color:var(--line)] text-base font-semibold text-destructive flex items-center justify-center gap-2 disabled:opacity-50"
                                onClick={archive}
                                disabled={busy !== null || refreshing}
                                data-testid="close-archive"
                            >
                                {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                                Archivar espacio
                            </button>
                            {!canArchive && (
                                <p className="text-xs text-center text-muted-foreground -mt-1">
                                    Para archivar, nadie puede deber nada ni quedar pagos por confirmar.
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
