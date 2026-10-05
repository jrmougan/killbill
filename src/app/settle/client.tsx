"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Clock } from "lucide-react";
import { EqCta, EqHeader, EqLabel, EqRow, EqToast, useEqToast } from "@/components/ui/eq";
import { GuestBanner } from "@/components/guest/guest-banner";
import { MethodPicker } from "@/components/settle/method-picker";
import { ReceiptTicket, TicketRow, TicketRule } from "@/components/settle/receipt-ticket";
import { isAtPeace, methodPhrase, shareLabel, type SettleMethod, type Ticket, type Transfer } from "@/components/settle/settle-model";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type PendingSettlement = { id: string; fromUserId: string; toUserId: string; amount: number; method: string };

type Done =
    | { kind: "confirmed"; method: string; /** What is still owed to me after this payment (cents). */ remaining: number }
    | { kind: "pending"; id: string | null; name: string; amount: number; method: string };

interface SettleClientProps {
    space: { id: string; name: string; status: string };
    me: string;
    isGuest: boolean;
    memberCount: number;
    /** The other member in a COUPLE-sized space (2 members), else null. */
    partnerId: string | null;
    names: Record<string, string>;
    /** My net balance in cents (positive = I'm owed). */
    balance: number;
    /** Every member of the space is at peace (not only me). */
    everyoneSettled: boolean;
    ticket: Ticket;
    meta: string;
    transfers: Transfer[];
    pending: PendingSettlement[];
}

/** Rule failures after which the screen is stale: refresh it so it shows the truth. */
const STALE_CODES = new Set([
    "SETTLEMENT_PENDING_EXISTS",
    "SETTLEMENT_CHANGED",
    "SETTLEMENT_NOT_PENDING",
    "SETTLEMENT_EXCEEDS_DEBT",
    "NOTHING_TO_SETTLE",
    "SPACE_NOT_WRITABLE",
]);

class StaleError extends Error {}

async function failure(res: Response, fallback: string): Promise<Error> {
    const json = await res.json().catch(() => ({}));
    const message = typeof json.error === "string" ? json.error : fallback;
    return STALE_CODES.has(json.code) ? new StaleError(message) : new Error(message);
}

export function SettleClient({ space, me, isGuest, memberCount, partnerId, names, balance, everyoneSettled, ticket, meta, transfers, pending }: SettleClientProps) {
    const router = useRouter();
    const [toast, showToast] = useEqToast(2400);
    const [method, setMethod] = useState<SettleMethod>("BIZUM");
    const [selected, setSelected] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<Done | null>(null);

    const nameOf = (id: string) => names[id] ?? "Alguien";
    const isCouple = memberCount === 2;
    const partnerName = isCouple && partnerId ? nameOf(partnerId) : null;
    const archived = space.status === "ARCHIVED";

    const t: Transfer | undefined = transfers[Math.min(selected, transfers.length - 1)];
    const outgoing = t?.direction === "pay"
        ? pending.find((p) => p.fromUserId === me && p.toUserId === t.userId)
        : undefined;
    const incoming = t?.direction === "receive"
        ? pending.find((p) => p.fromUserId === t.userId && p.toUserId === me)
        : undefined;

    // ---- actions ----------------------------------------------------------

    async function post(body: Record<string, unknown>) {
        const res = await fetch("/api/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, groupId: space.id }),
        });
        if (!res.ok) throw await failure(res, "No se pudo registrar el pago");
        return (await res.json()) as { settlement?: { id: string; status: string; amount: number }; merged?: boolean };
    }

    async function run(action: () => Promise<Done>) {
        setSubmitting(true);
        setError(null);
        try {
            setDone(await action());
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Algo ha fallado. Inténtalo de nuevo.");
            if (e instanceof StaleError) router.refresh();
        } finally {
            setSubmitting(false);
        }
    }

    const iPaid = () => run(async () => {
        if (!t) throw new Error("No hay nada que pagar");
        const json = await post({ toUserId: t.userId, amount: t.amount / 100, method });
        return { kind: "pending", id: json.settlement?.id ?? null, name: nameOf(t.userId), amount: t.amount, method };
    });

    const theyPaid = () => run(async () => {
        if (!t) throw new Error("No hay nada que cobrar");
        const json = await post({ fromUserId: t.userId, amount: t.amount / 100, method });
        const paid = json.settlement?.amount ?? t.amount;
        return { kind: "confirmed", method, remaining: balance - paid };
    });

    const confirmIncoming = () => run(async () => {
        if (!incoming) throw new Error("No hay pago que confirmar");
        const res = await fetch(`/api/settle/${incoming.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // The amount I am looking at: 409 SETTLEMENT_CHANGED if it was edited.
            body: JSON.stringify({ status: "CONFIRMED", expectedAmountCents: incoming.amount }),
        });
        if (!res.ok) throw await failure(res, "No se pudo confirmar el pago");
        return { kind: "confirmed", method: incoming.method, remaining: balance - incoming.amount };
    });

    async function remind() {
        const amount = formatCurrency(Math.abs(balance));
        const url = `${window.location.origin}/settle?space=${encodeURIComponent(space.id)}`;
        const text = isCouple
            ? `¡Hola, ${partnerName}! Para quedar en paz en ${space.name} me debes ${amount}. Lo tienes en EQUIL.`
            : `Cuentas de ${space.name}: me quedan ${amount} por cobrar. Entrad en EQUIL para quedar en paz.`;
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: "Quedar en paz", text, url });
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

    // ---- states -----------------------------------------------------------

    const header = (
        <EqHeader back="/dashboard">
            <h1 className="sr-only">Quedar en paz</h1>
            <Link href={`/settle/history?space=${encodeURIComponent(space.id)}`} className="ml-auto text-sm font-semibold text-primary px-1">
                Historial
            </Link>
        </EqHeader>
    );

    if (done?.kind === "pending") {
        return (
            <Screen>
                {header}
                <Centered
                    testId="settle-pending"
                    icon={<Clock className="h-10 w-10" />}
                    tone="tint"
                    title={`Pendiente de que ${done.name} confirme`}
                    sub={`Has registrado ${formatCurrency(done.amount)} ${methodPhrase(done.method)}. Contará en el saldo cuando ${done.name} confirme que lo ha recibido.`}
                />
                <Footer>
                    <EqCta onClick={() => router.push("/dashboard")}>Volver al inicio</EqCta>
                    {done.id && (
                        <Link href={`/settle/${done.id}`} className="text-sm font-semibold text-primary p-1">
                            Ver el pago
                        </Link>
                    )}
                </Footer>
            </Screen>
        );
    }

    if (done?.kind === "confirmed" || isAtPeace(balance)) {
        const registered = done?.kind === "confirmed";
        const stillOpen = registered && !isAtPeace(done.remaining);
        // In a group I can be at peace while others still owe each other.
        const onlyMe = !stillOpen && !isCouple && !everyoneSettled;
        const title = stillOpen ? "Pago registrado" : onlyMe ? "Tú estás en paz" : "Estáis en paz";
        let sub: string;
        if (stillOpen) {
            sub = `Pago registrado ${methodPhrase(done.method)}. Aún te ${isCouple ? "debe" : "deben"} ${formatCurrency(done.remaining)}.`;
        } else if (registered) {
            sub = `Pago registrado ${methodPhrase(done.method)}. Lo verás en Gastos.`;
        } else if (onlyMe) {
            sub = `No tienes nada pendiente, pero aún quedan cuentas entre otros miembros de ${space.name}.`;
        } else {
            sub = `No hay nada pendiente en ${space.name}.`;
        }
        return (
            <Screen>
                {header}
                <Centered
                    testId="settle-peace"
                    icon={<Check className="h-10 w-10" strokeWidth={2.5} />}
                    title={title}
                    sub={sub}
                >
                    {!registered && <PendingList pending={pending} me={me} nameOf={nameOf} />}
                </Centered>
                <Footer>
                    <EqCta onClick={() => router.push("/dashboard")}>Volver al inicio</EqCta>
                    {stillOpen && (
                        <button type="button" onClick={() => { setDone(null); setSelected(0); }} className="text-sm font-semibold text-primary p-1">
                            Seguir saldando
                        </button>
                    )}
                </Footer>
                {toast && <EqToast>{toast}</EqToast>}
            </Screen>
        );
    }

    // ---- not at peace: the receipt ticket ----------------------------------

    const owed = balance > 0;
    const balLabel = isCouple
        ? owed ? `${partnerName} te debe` : `Le debes a ${partnerName}`
        : owed ? "Te deben" : "Debes";
    const eachLabel = shareLabel(ticket, memberCount);
    const showTransfers = !isCouple || transfers.length > 1;

    let cta: React.ReactNode = null;
    if (!archived && t) {
        if (t.direction === "pay" && outgoing) {
            cta = (
                <>
                    <p className="text-sm text-muted-foreground text-center" data-testid="settle-outgoing-pending">
                        Ya registraste {formatCurrency(outgoing.amount)} para {nameOf(t.userId)}. Pendiente de que lo confirme.
                    </p>
                    <EqCta variant="outline" onClick={() => router.push(`/settle/${outgoing.id}`)}>Ver el pago</EqCta>
                </>
            );
        } else if (t.direction === "pay") {
            cta = <EqCta onClick={iPaid} disabled={submitting} aria-busy={submitting}>Ya he pagado</EqCta>;
        } else if (incoming) {
            cta = (
                <>
                    <EqCta onClick={confirmIncoming} disabled={submitting} aria-busy={submitting}>
                        Confirmar pago de {nameOf(t.userId)}
                    </EqCta>
                    <Link href={`/settle/${incoming.id}`} className="text-sm font-semibold text-primary p-1">
                        {nameOf(t.userId)} dice que te ha pagado {formatCurrency(incoming.amount)} · ver
                    </Link>
                </>
            );
        } else {
            cta = <EqCta onClick={theyPaid} disabled={submitting} aria-busy={submitting}>Ya me ha pagado</EqCta>;
        }
    }
    const canRemind = !archived && owed && !incoming;
    const usesMethod = !archived && !!t && !outgoing && !incoming;

    return (
        <Screen>
            {header}
            <div className="flex-1 flex flex-col gap-[22px] pb-6">
                {isGuest && <div className="px-5 pt-3"><GuestBanner /></div>}
                {archived && (
                    <p className="mx-5 mt-3 rounded-[14px] bg-[var(--track)] px-4 py-3 text-[13px] text-muted-foreground" data-testid="settle-archived">
                        {space.name} está archivado: solo lectura.
                    </p>
                )}

                <ReceiptTicket className="mx-5 mt-4" data-testid="settle-ticket">
                    <h2 className="text-[22px] font-bold tracking-[-0.02em] text-center">Cuenta de {space.name}</h2>
                    <p className="text-center text-muted-foreground font-mono text-[11px] -mt-1.5" data-testid="settle-ticket-meta">{meta}</p>
                    <TicketRule />
                    <TicketRow label="Total común" value={formatCurrency(ticket.total)} />
                    <TicketRow label={eachLabel} value={formatCurrency(ticket.myShare)} muted />
                    <TicketRule />
                    <TicketRow label="Pagaste tú" value={formatCurrency(ticket.paidByMe)} />
                    <TicketRow label={isCouple ? `Pagó ${partnerName}` : "Pagaron los demás"} value={formatCurrency(ticket.paidByOthers)} />
                    {ticket.payments !== 0 && (
                        <TicketRow
                            label={ticket.payments > 0 ? "Pagos que hiciste" : "Pagos recibidos"}
                            value={`${ticket.payments > 0 ? "+" : "−"}${formatCurrency(Math.abs(ticket.payments))}`}
                            muted
                            testId="settle-ticket-payments"
                        />
                    )}
                    {ticket.carry !== 0 && (
                        <TicketRow
                            label="Saldo anterior"
                            value={`${ticket.carry > 0 ? "+" : "−"}${formatCurrency(Math.abs(ticket.carry))}`}
                            muted
                            testId="settle-ticket-carry"
                        />
                    )}
                    <TicketRule />
                    <div className="flex justify-between items-baseline gap-3 font-semibold">
                        <span>{balLabel}</span>
                        <span
                            data-testid="settle-balance"
                            className={cn(
                                "text-[32px] font-bold tracking-[-0.03em] tabular-nums",
                                owed ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                            )}
                        >
                            {formatCurrency(Math.abs(balance))}
                        </span>
                    </div>
                </ReceiptTicket>

                {showTransfers && transfers.length > 0 && (
                    <TransferPicker
                        transfers={transfers}
                        selected={selected}
                        onSelect={setSelected}
                        nameOf={nameOf}
                        disabled={archived}
                    />
                )}

                {usesMethod && (
                    <div className="px-5">
                        <MethodPicker value={method} onChange={setMethod} />
                    </div>
                )}

                <div className="px-5">
                    <PendingList pending={pending} me={me} nameOf={nameOf} />
                </div>
            </div>

            <Footer>
                {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
                {cta}
                {canRemind && (
                    <button type="button" onClick={remind} className="text-sm font-semibold text-primary p-1">
                        {isCouple ? `Recordárselo a ${partnerName}` : "Recordárselo al grupo"}
                    </button>
                )}
            </Footer>
            {toast && <EqToast>{toast}</EqToast>}
        </Screen>
    );
}

// ---- layout pieces ---------------------------------------------------------

function Screen({ children }: { children: React.ReactNode }) {
    return <main className="eq-in min-h-dvh max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)]">{children}</main>;
}

function Footer({ children }: { children: React.ReactNode }) {
    return (
        <div className="mt-auto px-5 pb-[max(env(safe-area-inset-bottom),30px)] flex flex-col gap-3 items-center">
            {children}
        </div>
    );
}

function Centered({
    icon,
    title,
    sub,
    tone = "solid",
    testId,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    sub: string;
    tone?: "solid" | "tint";
    testId?: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 py-10 text-center" data-testid={testId}>
            <div
                aria-hidden
                className={cn(
                    "h-[84px] w-[84px] rounded-full flex items-center justify-center",
                    tone === "solid" ? "bg-primary text-primary-foreground" : "bg-[var(--accent-tint)] text-primary"
                )}
            >
                {icon}
            </div>
            <h2 className="text-[30px] font-bold tracking-[-0.02em] leading-tight text-balance">{title}</h2>
            <p className="text-[15px] text-muted-foreground leading-[1.45] text-pretty">{sub}</p>
            {children && <div className="w-full pt-4 text-left">{children}</div>}
        </div>
    );
}

/** Group mode: the suggested transfers that involve me, as a native radio group. */
function TransferPicker({
    transfers,
    selected,
    onSelect,
    nameOf,
    disabled,
}: {
    transfers: Transfer[];
    selected: number;
    onSelect: (i: number) => void;
    nameOf: (id: string) => string;
    disabled?: boolean;
}) {
    return (
        <div className="px-5">
        <fieldset className="flex flex-col gap-2" disabled={disabled} data-testid="settle-transfers">
            <legend className="text-xs font-semibold text-muted-foreground mb-2">Pagos sugeridos</legend>
            {transfers.map((tr, i) => {
                const active = i === selected;
                const who = nameOf(tr.userId);
                const text = tr.direction === "pay" ? `Pagas a ${who}` : `${who} te paga`;
                return (
                    <label
                        key={`${tr.direction}-${tr.userId}`}
                        className={cn(
                            "relative h-14 rounded-[14px] bg-card px-4 flex items-center justify-between gap-3 text-[15px] cursor-pointer transition-colors",
                            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                            active ? "border-2 border-primary" : "border border-[color:var(--line)]"
                        )}
                    >
                        <input
                            type="radio"
                            name="settle-transfer"
                            value={i}
                            checked={active}
                            onChange={() => onSelect(i)}
                            aria-label={`${text}: ${formatCurrency(tr.amount)}`}
                            className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
                        />
                        <span className="font-semibold truncate">{text}</span>
                        <span
                            className={cn(
                                "font-semibold tabular-nums",
                                tr.direction === "pay" ? "text-[color:var(--negative)]" : "text-[color:var(--positive)]"
                            )}
                        >
                            {formatCurrency(tr.amount)}
                        </span>
                    </label>
                );
            })}
        </fieldset>
        </div>
    );
}

/** PENDING settlements that involve me (either side), linking to the detail. */
function PendingList({ pending, me, nameOf }: { pending: PendingSettlement[]; me: string; nameOf: (id: string) => string }) {
    if (pending.length === 0) return null;
    return (
        <section className="flex flex-col" aria-labelledby="settle-pending-label" data-testid="settle-pending-list">
            <EqLabel id="settle-pending-label" className="mb-1">Pagos por confirmar</EqLabel>
            {pending.map((p) => {
                const toMe = p.toUserId === me;
                return (
                    <EqRow
                        key={p.id}
                        href={`/settle/${p.id}`}
                        icon={<Clock className="h-[18px] w-[18px]" />}
                        iconTint={toMe}
                        title={toMe ? `${nameOf(p.fromUserId)} te ha pagado` : `Pagaste a ${nameOf(p.toUserId)}`}
                        sub={toMe ? "Te toca confirmarlo" : `Esperando a ${nameOf(p.toUserId)}`}
                        amount={formatCurrency(p.amount)}
                    />
                );
            })}
        </section>
    );
}
