"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Archive, DoorClosed, Hourglass, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil, REOPEN_CONSEQUENCES, SETTLING_CONSEQUENCES } from "@/lib/space-ui";
import { setFlashToast } from "@/lib/flash-toast";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { EqToast, useEqToast } from "@/components/ui/eq";

/** One line of step 2: a PENDING payment or an open debt of the simplified plan. */
export type CloseItem = {
    kind: "pending" | "debt";
    /** Settlement id (pending) or `${fromId}>${toId}` (debt). */
    id: string;
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amountCents: number;
};

type Pending = "settle" | "reopen" | "archive" | null;
type ActionError = { message: string; href: string | null };

const linkCls = "-my-2.5 min-h-11 inline-flex items-center text-[13px] font-semibold text-primary";

/**
 * Guided close of a space as a three-step checklist:
 * 1. "Cerrar cuentas" — PATCH ACTIVE→SETTLING (only the status changes, so
 *    no PENDING payment is created on anyone's behalf) or "Reabrir".
 * 2. "Saldar deudas" — every debt of the space with the action that belongs to
 *    the viewer: "Saldar deuda" (debtor), "Revisar pago" (receiver of a PENDING)
 *    or who we are waiting for; "Faltan N".
 * 3. "Archivar para siempre" — PATCH →ARCHIVED from a danger sheet, only while
 *    SETTLING; `archiveBlockReason` disables its CTA and a 409 is painted in it.
 * Every transition is reviewed in a `CriticalActionSheet`.
 */
export function CloseSpaceClient({
    spaceId,
    spaceName,
    type,
    status,
    expiresAt,
    viewerId,
    items,
    canManage,
    settleHref,
    archiveBlockReason,
}: {
    spaceId: string;
    spaceName: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    /** ISO string; the EPHEMERAL trip end (caps guest access, never closes the space). */
    expiresAt?: string | null;
    viewerId: string;
    items: CloseItem[];
    canManage: boolean;
    settleHref: string;
    /** "Falta confirmar 1 pago" / "Falta saldar 2 deudas"; null when it can be archived (the API re-checks). */
    archiveBlockReason: string | null;
}) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [busy, setBusy] = useState<Pending>(null);
    const [confirming, setConfirming] = useState<Pending>(null);
    const [error, setError] = useState<ActionError | null>(null);
    const [toast, showToast] = useEqToast(3500);

    const days = type === SpaceType.EPHEMERAL && status === SpaceStatus.ACTIVE ? daysUntil(expiresAt) : null;
    const countdownLabel =
        days === null ? null :
        days < 0 ? "El viaje ya terminó" :
        days <= 1 ? "El viaje termina hoy" :
        `Quedan ${days} días de viaje`;

    const archived = status === SpaceStatus.ARCHIVED;
    const closed = status !== SpaceStatus.ACTIVE;
    const iOwe = items.some((i) => i.fromId === viewerId);
    const step = !closed ? 1 : items.length > 0 ? 2 : archived ? 4 : 3;

    const patch = async (next: SpaceStatus, key: Exclude<Pending, null>, onDone: () => void) => {
        setBusy(key);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: next }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                setConfirming(null);
                onDone();
                return;
            }
            setError({ message: data?.error || "No se pudo completar la acción", href: data?.settleUrl ?? null });
        } catch {
            setError({ message: "Sin conexión. Inténtalo de nuevo.", href: null });
        } finally {
            setBusy(null);
        }
    };

    const refreshWith = (msg: string) => {
        showToast(msg);
        startTransition(() => router.refresh());
    };

    const archive = () =>
        patch(SpaceStatus.ARCHIVED, "archive", () => {
            setFlashToast(`${spaceName} archivado. Lo encontrarás en Espacios.`);
            startTransition(() => {
                router.push("/dashboard");
                router.refresh();
            });
        });

    const open = (p: Pending) => {
        setError(null);
        setConfirming(p);
    };
    const disabled = busy !== null || refreshing;

    return (
        <div className="min-h-screen pb-28 eq-in">
            <header className="px-5 pt-3 flex items-center">
                <Link href={`/spaces/${spaceId}`} aria-label="Volver al espacio" className="-ml-2.5 h-11 w-11 flex items-center justify-center">
                    <ArrowLeft className="h-6 w-6" aria-hidden="true" />
                </Link>
            </header>
            <div className="px-5 pt-1 flex flex-col gap-1">
                <h1 className="text-2xl font-bold tracking-[-0.02em] break-words">Cerrar {spaceName}</h1>
                <p className="text-[15px] text-muted-foreground">Tres pasos: cerrar cuentas, saldar las deudas y archivar.</p>
            </div>

            <div className="px-5 pt-5 flex flex-col gap-4">
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

                <ol className="flex flex-col gap-3">
                    <Step n={1} title="Cerrar cuentas" done={closed} current={step === 1}>
                        {!closed ? (
                            <>
                                <p className="text-[13px] text-muted-foreground">
                                    Al cerrarlas ya no se pueden añadir gastos; solo saldar deudas. Se puede reabrir.
                                </p>
                                {canManage ? (
                                    <button
                                        type="button"
                                        className="mt-1 w-full h-12 rounded-[14px] bg-primary text-primary-foreground text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                                        onClick={() => open("settle")}
                                        disabled={disabled}
                                        data-testid="close-start-settling"
                                    >
                                        <DoorClosed className="h-4 w-4" aria-hidden="true" />
                                        Empezar a cerrar cuentas
                                    </button>
                                ) : (
                                    <p className="text-[13px] text-muted-foreground">Quien gestiona el espacio puede empezar a cerrarlas.</p>
                                )}
                            </>
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[13px] text-muted-foreground">
                                    {archived ? "Ya no se pueden añadir gastos." : "Ya no se pueden añadir gastos; solo saldar deudas."}
                                </p>
                                {canManage && !archived && (
                                    <button
                                        type="button"
                                        className={cn(linkCls, "flex-none disabled:opacity-50")}
                                        onClick={() => open("reopen")}
                                        disabled={disabled}
                                        data-testid="close-reopen"
                                    >
                                        Reabrir
                                    </button>
                                )}
                            </div>
                        )}
                    </Step>

                    <Step
                        n={2}
                        title="Saldar deudas"
                        done={items.length === 0}
                        current={step === 2}
                        aside={
                            <span data-testid="close-progress" className="text-[13px] font-semibold text-muted-foreground tabular-nums">
                                {items.length === 0 ? "Al día" : `Faltan ${items.length}`}
                            </span>
                        }
                    >
                        {!iOwe && (
                            <p data-testid="close-no-debts" className="text-[13px] text-muted-foreground">
                                {items.length === 0 ? "Estáis al día: nadie debe nada en este espacio." : "Tú no debes nada a nadie."}
                            </p>
                        )}
                        {items.length > 0 && (
                            <ul className="-mx-4 -mb-2 border-t border-[color:var(--line-2)] divide-y divide-[color:var(--line-2)]">
                                {items.map((item) => (
                                    <CloseRow key={item.id} item={item} viewerId={viewerId} settleHref={archived ? null : settleHref} />
                                ))}
                            </ul>
                        )}
                    </Step>

                    <Step n={3} title="Archivar para siempre" done={archived} current={step === 3}>
                        <p className="text-[13px] text-muted-foreground">
                            {archived
                                ? "Archivado: queda solo para consultar."
                                : "Queda como recuerdo, solo para consultar. No se puede deshacer."}
                        </p>
                        {!archived && !closed && <p className="text-[13px] text-muted-foreground">Primero, cerrad las cuentas.</p>}
                        {status === SpaceStatus.SETTLING && (canManage ? (
                            <>
                                <button
                                    type="button"
                                    className="mt-1 w-full h-12 rounded-[14px] bg-card border border-[color:var(--line)] text-[15px] font-semibold text-destructive flex items-center justify-center gap-2 disabled:opacity-50"
                                    onClick={() => open("archive")}
                                    disabled={disabled}
                                    aria-describedby={archiveBlockReason ? "close-archive-reason" : undefined}
                                    data-testid="close-archive"
                                >
                                    {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                                    Archivar para siempre
                                </button>
                                {archiveBlockReason && (
                                    <p id="close-archive-reason" data-testid="close-archive-reason" className="text-[13px] text-muted-foreground">
                                        {archiveBlockReason}: hay que saldarlo todo antes de archivar.
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-[13px] text-muted-foreground">Avisa a quien gestiona el espacio para archivarlo.</p>
                        ))}
                    </Step>
                </ol>
            </div>

            {confirming === "settle" && (
                <CriticalActionSheet
                    testId="settle-sheet"
                    title={`¿Cerrar las cuentas de ${spaceName}?`}
                    consequences={SETTLING_CONSEQUENCES}
                    confirmLabel="Empezar a cerrar cuentas"
                    busy={busy === "settle"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() =>
                        patch(SpaceStatus.SETTLING, "settle", () => refreshWith("Estáis cerrando cuentas. Ahora saldad las deudas."))
                    }
                    onClose={() => setConfirming(null)}
                />
            )}
            {confirming === "reopen" && (
                <CriticalActionSheet
                    testId="reopen-sheet"
                    title={`¿Reabrir ${spaceName}?`}
                    consequences={REOPEN_CONSEQUENCES}
                    confirmLabel="Reabrir espacio"
                    busy={busy === "reopen"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={() => patch(SpaceStatus.ACTIVE, "reopen", () => refreshWith("Espacio reabierto: ya podéis añadir gastos."))}
                    onClose={() => setConfirming(null)}
                />
            )}
            {confirming === "archive" && (
                <CriticalActionSheet
                    testId="archive-sheet"
                    title={`¿Archivar ${spaceName}?`}
                    tone="danger"
                    consequences={[
                        "Quedará solo para consultar: nadie podrá añadir gastos, saldar ni cambiar nada.",
                        "Los gastos y los pagos se conservan.",
                    ]}
                    reversible={false}
                    confirmLabel="Archivar para siempre"
                    confirmDisabled={!!archiveBlockReason}
                    disabledReason={archiveBlockReason}
                    busy={busy === "archive"}
                    error={error?.message}
                    errorHref={error?.href}
                    onConfirm={archive}
                    onClose={() => setConfirming(null)}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}

/** A numbered checklist card: green check when done, filled number when it is the current step. */
function Step({
    n,
    title,
    done,
    current,
    aside,
    children,
}: {
    n: number;
    title: string;
    done: boolean;
    current: boolean;
    aside?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <li
            data-testid={`close-step-${n}`}
            data-done={done}
            aria-current={current ? "step" : undefined}
            className={cn(
                "rounded-[18px] bg-card border px-4 py-3.5 flex flex-col gap-2",
                current ? "border-[color:var(--line)]" : "border-[color:var(--line-2)]",
            )}
        >
            <div className="flex items-center gap-3">
                <span
                    className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold tabular-nums",
                        done
                            ? "bg-[var(--positive-tint)] text-[color:var(--positive)]"
                            : current
                              ? "bg-primary text-primary-foreground"
                              : "bg-[var(--track)] text-muted-foreground",
                    )}
                    aria-hidden="true"
                >
                    {done ? <Check className="h-3.5 w-3.5" /> : n}
                </span>
                <h2 className="flex-1 min-w-0 text-[15px] font-semibold">
                    <span className="sr-only">Paso {n}: </span>
                    {title}
                    {done && <span className="sr-only"> (hecho)</span>}
                </h2>
                {aside}
            </div>
            {children}
        </li>
    );
}

/**
 * One debt or PENDING payment, worded for the viewer, with the action that is
 * theirs (or who we are waiting for). Mine keep `close-debt-row` ("Debes a X"),
 * the rest of the plan is `close-plan-row`, PENDING ones `close-settlement-row`.
 */
function CloseRow({ item, viewerId, settleHref }: { item: CloseItem; viewerId: string; settleHref: string | null }) {
    const fromMe = item.fromId === viewerId;
    const toMe = item.toId === viewerId;

    let title: string;
    let next: React.ReactNode;
    let testId: string;
    if (item.kind === "pending") {
        testId = "close-settlement-row";
        title = fromMe ? `Pago a ${item.toName} · por confirmar` : toMe ? `${item.fromName} dice que te ha pagado` : `${item.fromName} dice que ha pagado a ${item.toName}`;
        next = toMe ? (
            <Link href={`/settle/${item.id}`} className={linkCls} data-testid="close-review-payment">
                Revisar pago
            </Link>
        ) : (
            `Falta que ${item.toName} lo confirme`
        );
    } else {
        testId = fromMe ? "close-debt-row" : "close-plan-row";
        title = fromMe ? `Debes a ${item.toName}` : toMe ? `${item.fromName} te debe` : `${item.fromName} debe a ${item.toName}`;
        next = fromMe && settleHref ? (
            <Link href={settleHref} className={linkCls} data-testid="close-settle-debt">
                Saldar deuda
            </Link>
        ) : (
            `Esperando a ${item.fromName}`
        );
    }

    return (
        <li data-testid={testId} data-status={item.kind === "pending" ? "PENDING" : "OPEN"} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 min-w-0">
                <span className="block text-[15px] break-words">{title}</span>
                <span className="block text-[12.5px] text-muted-foreground">{next}</span>
            </span>
            <span
                data-testid="close-amount"
                className={cn("text-[15px] font-semibold tabular-nums shrink-0", fromMe && item.kind === "debt" && "text-[color:var(--negative)]")}
            >
                {formatCurrency(item.amountCents)}
            </span>
        </li>
    );
}
