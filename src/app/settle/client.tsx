"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Clock } from "lucide-react";
import { EqCta, EqHeader, EqLabel, EqRow, EqToast, useEqToast } from "@/components/ui/eq";
import { GuestBanner } from "@/components/guest/guest-banner";
import { MethodPicker } from "@/components/settle/method-picker";
import { PendingPaymentSheet, RecordSettlementSheet } from "@/components/settle/settle-review-sheet";
import { ReceiptTicket, TicketRow, TicketRule } from "@/components/settle/receipt-ticket";
import { isAtPeace, methodPhrase, shareLabel, type SettleMethod, type Ticket, type Transfer } from "@/components/settle/settle-model";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type PendingSettlement = { id: string; fromUserId: string; toUserId: string; amount: number; method: string };

/** The payment just recorded (`id` from the response, for "Ver el pago"). */
type Done = { id: string | null; name: string; amount: number; method: string } & (
    | { kind: "confirmed"; /** What is still owed to me after this payment (cents). */ remaining: number }
    | { kind: "pending" }
);

/** The review sheet open over the ticket, with the transfer it was opened for. */
type Review =
    | { kind: "pay" | "receive"; t: Transfer; method: SettleMethod }
    | { kind: "incoming"; t: Transfer; incoming: PendingSettlement };

interface SettleClientProps {
    space: { id: string; name: string; status: string };
    me: string;
    isGuest: boolean;
    /** OWNER/ADMIN registered member: may archive the space once everything is settled. */
    canArchive: boolean;
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

export function SettleClient({ space, me, isGuest, canArchive, memberCount, partnerId, names, balance, everyoneSettled, ticket, meta, transfers, pending }: SettleClientProps) {
    const router = useRouter();
    const [toast, showToast] = useEqToast(2400);
    const [method, setMethod] = useState<SettleMethod>("BIZUM");
    const [selected, setSelected] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<Done | null>(null);
    const [review, setReview] = useState<Review | null>(null);

    const nameOf = (id: string) => names[id] ?? "Alguien";
    const isCouple = memberCount === 2;
    const partnerName = isCouple && partnerId ? nameOf(partnerId) : null;
    const archived = space.status === "ARCHIVED";

    // A transfer I already reported as paid is not offered again: it shows as
    // one "Falta que X confirme" block instead of a radio + CTA.
    const outgoingPending = pending.filter((p) => p.fromUserId === me);
    const open = transfers.filter((tr) => tr.direction !== "pay" || !outgoingPending.some((p) => p.toUserId === tr.userId));
    const t: Transfer | undefined = open[Math.min(selected, open.length - 1)];
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

    // Every write goes through a review sheet: run() is only called from its CTA,
    // shows failures inside the sheet and closes it on success.
    async function run(action: () => Promise<Done>) {
        setSubmitting(true);
        setError(null);
        try {
            setDone(await action());
            setReview(null);
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Algo ha fallado. Inténtalo de nuevo.");
            if (e instanceof StaleError) router.refresh();
        } finally {
            setSubmitting(false);
        }
    }

    const iPaid = (tr: Transfer, cents: number, how: SettleMethod) => run(async () => {
        const json = await post({ toUserId: tr.userId, amount: cents / 100, method: how });
        return { kind: "pending", id: json.settlement?.id ?? null, name: nameOf(tr.userId), amount: json.settlement?.amount ?? cents, method: how };
    });

    const theyPaid = (tr: Transfer, cents: number, how: SettleMethod) => run(async () => {
        const json = await post({ fromUserId: tr.userId, amount: cents / 100, method: how });
        const paid = json.settlement?.amount ?? cents;
        return { kind: "confirmed", id: json.settlement?.id ?? null, name: nameOf(tr.userId), amount: paid, method: how, remaining: balance - paid };
    });

    const confirmIncoming = (incoming: PendingSettlement) => run(async () => {
        const res = await fetch(`/api/settle/${incoming.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // The amount I am looking at: 409 SETTLEMENT_CHANGED if it was edited.
            body: JSON.stringify({ status: "CONFIRMED", expectedAmountCents: incoming.amount }),
        });
        if (!res.ok) throw await failure(res, "No se pudo confirmar el pago");
        return {
            kind: "confirmed",
            id: incoming.id,
            name: nameOf(incoming.fromUserId),
            amount: incoming.amount,
            method: incoming.method,
            remaining: balance - incoming.amount,
        };
    });

    async function share(title: string, text: string, path: string) {
        const url = `${window.location.origin}${path}`;
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title, text, url });
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

    /** Creditor → debtor: the debt is still open. */
    function remind() {
        const amount = formatCurrency(Math.abs(balance));
        const text = isCouple
            ? `¡Hola, ${partnerName}! En ${space.name} me debes ${amount}. Puedes saldarlo desde EQUIL.`
            : `${space.name}: me quedan ${amount} por cobrar. Entrad en EQUIL para saldar vuestra parte.`;
        return share("Deuda pendiente en EQUIL", text, `/settle?space=${encodeURIComponent(space.id)}`);
    }

    /** Debtor → creditor: please confirm the payment I reported. */
    function askToConfirm(p: { id: string | null; name: string; amount: number; method: string }) {
        const text = `¡Hola, ${p.name}! Te he pagado ${formatCurrency(p.amount)} ${methodPhrase(p.method)} en ${space.name}. ¿Lo confirmas en EQUIL?`;
        return share("Pago por confirmar en EQUIL", text, p.id ? `/settle/${p.id}` : `/settle?space=${encodeURIComponent(space.id)}`);
    }

    function openReview(r: Review) {
        setError(null);
        setReview(r);
    }

    function closeReview() {
        setReview(null);
        setError(null);
    }

    // ---- states -----------------------------------------------------------

    const header = (
        <EqHeader back="/dashboard" title="Saldar deuda">
            <Link href={`/settle/history?space=${encodeURIComponent(space.id)}`} className="-my-2.5 min-h-11 flex items-center text-sm font-semibold text-primary px-1">
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
                    title={`Avisado a ${done.name}`}
                    sub={`Le hemos dicho que le has pagado ${formatCurrency(done.amount)} ${methodPhrase(done.method)}. La deuda quedará saldada cuando lo confirme.`}
                />
                <Footer>
                    <EqCta onClick={() => router.push("/dashboard")}>Volver al inicio</EqCta>
                    <EqCta variant="outline" onClick={() => askToConfirm(done)}>Pedirle que lo confirme</EqCta>
                    {done.id && <TextLink href={`/settle/${done.id}`}>Ver el pago</TextLink>}
                </Footer>
                {toast && <EqToast>{toast}</EqToast>}
            </Screen>
        );
    }

    if (done?.kind === "confirmed" || isAtPeace(balance)) {
        const registered = done?.kind === "confirmed";
        const stillOpen = registered && !isAtPeace(done.remaining);
        // In a group I can be at peace while others still owe each other.
        const onlyMe = !stillOpen && !isCouple && !everyoneSettled;
        // "Deuda saldada" only right after a payment that leaves the balance at 0;
        // opening /settle with nothing owed is just "al día".
        const rest = stillOpen ? formatCurrency(Math.abs(done.remaining)) : "";
        const title = stillOpen
            ? done.remaining > 0
                ? `Pago registrado · aún te ${isCouple ? "debe" : "deben"} ${rest}`
                : `Pago registrado · aún debes ${rest}`
            : registered ? "Deuda saldada" : onlyMe ? "Ya estás al día" : "Estáis al día";
        // SETTLING with every balance at zero: the last step is archiving.
        const readyToArchive = space.status === "SETTLING" && !stillOpen && everyoneSettled;
        let sub: string;
        if (registered) {
            sub = `Has registrado ${formatCurrency(done.amount)} de ${done.name} ${methodPhrase(done.method)}.`;
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
                    {readyToArchive && !canArchive && (
                        <p className="text-[15px] text-muted-foreground text-center" data-testid="settle-archive-hint">
                            Avisa a quien gestiona el espacio para archivarlo.
                        </p>
                    )}
                </Centered>
                <Footer>
                    {readyToArchive && canArchive && (
                        <EqCta onClick={() => router.push(`/spaces/${space.id}/close`)} data-testid="settle-archive">Terminar y archivar</EqCta>
                    )}
                    {done?.id && <Link href={`/settle/${done.id}`} className={OUTLINE_LINK}>Ver el pago</Link>}
                    {stillOpen && (
                        <EqCta variant="outline" onClick={() => { setDone(null); setSelected(0); }}>Saldar el resto</EqCta>
                    )}
                    {readyToArchive && canArchive
                        ? <TextLink href="/dashboard">Volver al inicio</TextLink>
                        : <EqCta onClick={() => router.push("/dashboard")}>Volver al inicio</EqCta>}
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
    const showTransfers = !isCouple || open.length > 1;
    const total = formatCurrency(Math.abs(balance));
    // The headline says who owes whom on its own; in a group, the second line
    // names the transfer the CTA will record.
    const headline = isCouple
        ? owed ? `${partnerName} te debe ${total}` : `Le debes ${total} a ${partnerName}`
        : owed ? `Te deben ${total} en total` : `Debes ${total} en total`;
    const transferLine = !isCouple && t
        ? t.direction === "pay"
            ? `Le pagas ${formatCurrency(t.amount)} a ${nameOf(t.userId)}`
            : `${nameOf(t.userId)} te paga ${formatCurrency(t.amount)}`
        : null;

    let cta: React.ReactNode = null;
    if (!archived && t) {
        if (t.direction === "pay") {
            cta = (
                <EqCta onClick={() => openReview({ kind: "pay", t, method })} className={CTA_WRAP}>
                    Ya le he pagado {formatCurrency(t.amount)} a {nameOf(t.userId)}
                </EqCta>
            );
        } else if (incoming) {
            cta = (
                <>
                    <EqCta onClick={() => openReview({ kind: "incoming", t, incoming })} className={CTA_WRAP}>
                        Sí, he recibido {formatCurrency(incoming.amount)} de {nameOf(t.userId)}
                    </EqCta>
                    <TextLink href={`/settle/${incoming.id}`}>
                        {nameOf(t.userId)} dice que te ha pagado {formatCurrency(incoming.amount)} · ver
                    </TextLink>
                </>
            );
        } else {
            cta = (
                <EqCta onClick={() => openReview({ kind: "receive", t, method })} className={CTA_WRAP}>
                    {nameOf(t.userId)} ya me ha pagado {formatCurrency(t.amount)}
                </EqCta>
            );
        }
    }
    const canRemind = !archived && owed && !incoming;
    const usesMethod = !archived && !!t && !incoming;
    const inFlight = outgoingPending.reduce((sum, p) => sum + p.amount, 0);

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

                <div className="px-5 pt-3 flex flex-col gap-1" data-testid="settle-summary">
                    <p className="text-[24px] font-bold tracking-[-0.02em] leading-tight text-balance">{headline}</p>
                    {transferLine && <p className="text-[15px] text-muted-foreground" data-testid="settle-summary-transfer">{transferLine}</p>}
                </div>

                <ReceiptTicket className="mx-5" data-testid="settle-ticket">
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
                            label="Pendiente de antes"
                            value={`${ticket.carry > 0 ? "+" : "−"}${formatCurrency(Math.abs(ticket.carry))}`}
                            muted
                            testId="settle-ticket-carry"
                        />
                    )}
                    <TicketRule />
                    <div className="flex justify-between items-baseline gap-3 font-semibold">
                        <span className="min-w-0">{balLabel}</span>
                        <span
                            data-testid="settle-balance"
                            className={cn(
                                "shrink-0 whitespace-nowrap text-[length:clamp(20px,8.9vw,32px)] font-bold tracking-[-0.03em] tabular-nums",
                                owed ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                            )}
                        >
                            {formatCurrency(Math.abs(balance))}
                        </span>
                    </div>
                    {inFlight > 0 && (
                        <TicketRow label="Pago en camino" value={`−${formatCurrency(inFlight)} · pendiente`} muted testId="settle-ticket-in-flight" />
                    )}
                </ReceiptTicket>

                {outgoingPending.length > 0 && (
                    <div className="px-5 flex flex-col gap-3">
                        {outgoingPending.map((p) => (
                            <OutgoingPending
                                key={p.id}
                                name={nameOf(p.toUserId)}
                                amount={p.amount}
                                href={`/settle/${p.id}`}
                                onAsk={() => askToConfirm({ id: p.id, name: nameOf(p.toUserId), amount: p.amount, method: p.method })}
                            />
                        ))}
                    </div>
                )}

                {showTransfers && open.length > 0 && (
                    <TransferPicker
                        transfers={open}
                        selected={selected}
                        onSelect={setSelected}
                        nameOf={nameOf}
                        disabled={archived}
                    />
                )}

                {usesMethod && (
                    <div className="px-5">
                        <MethodPicker
                            value={method}
                            onChange={setMethod}
                            label={t?.direction === "pay" ? "¿Cómo le has pagado?" : "¿Cómo te ha pagado?"}
                        />
                    </div>
                )}

                <div className="px-5">
                    <PendingList pending={pending.filter((p) => p.toUserId === me)} me={me} nameOf={nameOf} />
                </div>
            </div>

            <Footer>
                {cta}
                {canRemind && (
                    <button type="button" onClick={remind} className={TEXT_LINK}>
                        {isCouple ? `Recordarle la deuda a ${partnerName}` : "Recordar la deuda al grupo"}
                    </button>
                )}
            </Footer>
            {review?.kind === "incoming" ? (
                <PendingPaymentSheet
                    status="CONFIRMED"
                    name={nameOf(review.t.userId)}
                    myName={nameOf(me)}
                    amountCents={review.incoming.amount}
                    method={review.incoming.method}
                    owedCents={review.t.amount}
                    busy={submitting}
                    error={error}
                    onConfirm={() => confirmIncoming(review.incoming)}
                    onClose={closeReview}
                />
            ) : review && (
                <RecordSettlementSheet
                    direction={review.kind}
                    name={nameOf(review.t.userId)}
                    maxCents={review.t.amount}
                    method={review.method}
                    busy={submitting}
                    error={error}
                    onConfirm={(cents) => (review.kind === "pay" ? iPaid : theyPaid)(review.t, cents, review.method)}
                    onClose={closeReview}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </Screen>
    );
}

// ---- layout pieces ---------------------------------------------------------

/** The CTAs carry a name and an amount: let a long one wrap instead of clipping. */
const CTA_WRAP = "h-auto min-h-14 px-5 py-3 text-center leading-snug text-balance";

/** EqCta "outline" look on a real link. */
const OUTLINE_LINK = "w-full h-14 rounded-[18px] text-base font-semibold flex items-center justify-center bg-card border border-[color:var(--line)] text-foreground";
const TEXT_LINK = "min-h-11 px-2 text-sm font-semibold text-primary inline-flex items-center";

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <Link href={href} className={TEXT_LINK}>{children}</Link>;
}

function Screen({ children }: { children: React.ReactNode }) {
    return <div className="eq-in min-h-dvh w-full max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)]">{children}</div>;
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
            <legend className="text-xs font-semibold text-muted-foreground mb-2">¿Qué deuda quieres saldar?</legend>
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

/** A payment I reported that the creditor has not confirmed yet: the only place it is shown. */
function OutgoingPending({ name, amount, href, onAsk }: { name: string; amount: number; href: string; onAsk: () => void }) {
    return (
        <div className="rounded-[18px] bg-card border border-[color:var(--line)] p-4 flex flex-col gap-3" data-testid="settle-outgoing-pending">
            <div className="flex items-center gap-3">
                <div aria-hidden className="h-10 w-10 flex-none rounded-[12px] bg-[var(--accent-tint)] text-primary flex items-center justify-center">
                    <Clock className="h-[18px] w-[18px]" />
                </div>
                <p className="text-[15px] font-semibold leading-snug">Falta que {name} confirme {formatCurrency(amount)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 -mb-1.5">
                <Link href={href} className={cn(TEXT_LINK, "px-0")}>Ver el pago pendiente</Link>
                <button type="button" onClick={onAsk} className={cn(TEXT_LINK, "px-0")}>Pedirle que lo confirme</button>
            </div>
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
                        title={toMe ? `${nameOf(p.fromUserId)} dice que te ha pagado` : `Pago a ${nameOf(p.toUserId)}`}
                        sub={toMe ? "Confírmalo cuando lo recibas" : `Falta que ${nameOf(p.toUserId)} lo confirme`}
                        amount={formatCurrency(p.amount)}
                    />
                );
            })}
        </section>
    );
}
