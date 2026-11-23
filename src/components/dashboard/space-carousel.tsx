"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, CircleAlert, Clock, HandCoins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActivateSpace } from "@/components/space/use-activate-space";

/** One card of the Inicio carousel (a shared space or the personal context). */
export type SpaceCardData = {
    key: string;
    /** "💑" */
    emoji: string;
    /** "Casa" (no emoji — also used for assistive tech). */
    name: string;
    /** "con Lucía" / "4 personas" / "Solo tú" */
    sub: string;
    /** "Lucía te debe" / "Personal este mes"… */
    label: string;
    /** Unsigned amount shown big ("12,00 €"). */
    amount: string;
    tone: "positive" | "negative" | "neutral";
    /**
     * Signed balance ("+12,00 €") exposed to assistive tech and as the
     * `balance-amount` test id on the ACTIVE shared card. Null for personal or a
     * couple still waiting for its second member.
     */
    signed: string | null;
    /** "Saldar deuda" target (active, shared, open balance); null hides it. */
    settleHref: string | null;
    /** Direction under "Saldar deuda": "Pagas 7,50 €" / "Cobras 79,30 €". */
    settleSub?: string | null;
    /** A payment I sent is waiting for confirmation (debtor side). */
    pendingNote?: string | null;
    /** A payment I sent was rejected this week: "Álvaro no recibió tu pago de 15,00 €" → its detail. */
    rejectedNote?: { text: string; href: string } | null;
};

/**
 * The cards have a fixed width, so a long amount ("2.633.939,47 €") must not
 * run out of it: step the font size down with the text length. Money is never
 * truncated; if it still does not fit, it wraps.
 */
function amountSize(amount: string, active: boolean): string {
    const n = amount.length;
    if (active) return n <= 12 ? "text-[34px]" : n <= 14 ? "text-[30px]" : "text-[26px]";
    return n <= 11 ? "text-[22px]" : n <= 13 ? "text-[19px]" : n <= 15 ? "text-[16px]" : "text-[14px]";
}

/**
 * Horizontal space carousel (prototype `is.home`): the active card is wide and
 * green, except when you owe money, when it turns terracotta. Green and
 * terracotta have almost the same luminance, so the color only reinforces: the
 * visible sign and the direction icon are what tell owing from being owed.
 * Tapping another card switches the active space via the existing active-group
 * mechanism. Dots + "Ver espacios" sit underneath.
 */
export function SpaceCarousel({
    cards,
    activeKey,
    spacesHref,
    locked = false,
}: {
    cards: SpaceCardData[];
    activeKey: string;
    spacesHref: string | null;
    /** Guest: caged to one space, cards are display-only. */
    locked?: boolean;
}) {
    const { activate, pending } = useActivateSpace();
    const activeRef = useRef<HTMLDivElement>(null);

    // Bring the active card into view (it may not be the first one).
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, [activeKey]);

    return (
        <section aria-label="Tus espacios">
            <div className="eq-scroll flex gap-2.5 overflow-x-auto px-5 snap-x">
                {cards.map((c) => {
                    const active = c.key === activeKey;
                    // U+2212, like rowBalance. Screen readers get `c.signed` instead.
                    const sign = c.tone === "positive" ? "+" : c.tone === "negative" ? "−" : "";
                    const shownAmount = `${sign}${c.amount}`;
                    const DirIcon = c.tone === "positive" ? ArrowDownLeft : c.tone === "negative" ? ArrowUpRight : Check;
                    const title = (
                        <span className="flex items-center gap-1.5 min-w-0 text-sm font-semibold">
                            <span aria-hidden="true" className="flex-none">{c.emoji}</span>
                            <span className="truncate">{c.name}</span>
                        </span>
                    );
                    // Mockup 2a: the wide active card puts "con Lucía" beside the name;
                    // the narrow ones move it to the bottom so neither is cut to "Perso…".
                    const header = active ? (
                        <div className="flex items-center justify-between gap-2 min-w-0">
                            {title}
                            <span className="flex-none max-w-[50%] truncate text-xs font-medium">{c.sub}</span>
                        </div>
                    ) : (
                        title
                    );
                    const body = (
                        <>
                            {header}
                            <div className="min-w-0">
                                {active ? (
                                    <div className="flex items-center gap-2">
                                        {c.signed && (
                                            <span
                                                aria-hidden="true"
                                                className={cn(
                                                    "h-6 w-6 flex-none rounded-full bg-white flex items-center justify-center",
                                                    c.tone === "negative" ? "text-[color:var(--negative)]" : "text-[color:var(--positive)]",
                                                )}
                                            >
                                                <DirIcon className="h-4 w-4" strokeWidth={2.75} />
                                            </span>
                                        )}
                                        <span className="min-w-0 text-[15px] font-semibold leading-tight [overflow-wrap:anywhere]">{c.label}</span>
                                    </div>
                                ) : (
                                    <div className="truncate text-xs text-muted-foreground">{c.label}</div>
                                )}
                                <div
                                    aria-hidden={c.signed ? true : undefined}
                                    className={cn(
                                        "font-bold tracking-[-0.03em] leading-[1.05] [overflow-wrap:anywhere]",
                                        amountSize(shownAmount, active),
                                        !active && c.tone === "positive" && "text-[color:var(--positive)]",
                                        !active && c.tone === "negative" && "text-[color:var(--negative)]",
                                    )}
                                >
                                    {shownAmount}
                                </div>
                                {active && c.signed && (
                                    <span data-testid="balance-amount" className="sr-only">{c.signed}</span>
                                )}
                            </div>
                        </>
                    );
                    if (active) {
                        return (
                            <div
                                key={c.key}
                                ref={activeRef}
                                aria-current="true"
                                data-testid="space-card-active"
                                data-tone={c.tone}
                                className={cn(
                                    "snap-center flex-none w-[248px] min-h-[150px] rounded-[22px] text-primary-foreground border p-4 flex flex-col justify-between gap-2 transition-[width,background-color] duration-250",
                                    c.tone === "negative" ? "bg-[var(--negative)] border-[color:var(--negative)]" : "bg-primary border-primary",
                                )}
                            >
                                {body}
                                {c.rejectedNote && (
                                    <Link
                                        href={c.rejectedNote.href}
                                        data-testid="rejected-note"
                                        className="-my-2 -ml-1 self-start min-h-11 px-1 flex items-center gap-1.5 text-[13px] font-semibold"
                                    >
                                        <CircleAlert className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                                        <span className="min-w-0 [overflow-wrap:anywhere]">{c.rejectedNote.text}</span>
                                    </Link>
                                )}
                                {c.pendingNote ? (
                                    <Link
                                        href={c.settleHref ?? "/settle"}
                                        data-testid="pending-out-note"
                                        className="-my-2 -ml-1 self-start min-h-11 px-1 flex items-center gap-1.5 text-[13px] font-semibold"
                                    >
                                        <Clock className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                                        <span className="min-w-0 [overflow-wrap:anywhere]">{c.pendingNote}</span>
                                    </Link>
                                ) : c.settleHref ? (
                                    // The direction sits under the link (described-by, not part of its name).
                                    <div className="-my-2 -ml-1 self-start flex flex-col">
                                        <Link
                                            href={c.settleHref}
                                            aria-describedby={c.settleSub ? `settle-sub-${c.key}` : undefined}
                                            className="min-h-11 px-1 flex items-center gap-1.5 text-[13px] font-semibold"
                                        >
                                            <HandCoins className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                                            Saldar deuda
                                        </Link>
                                        {c.settleSub && (
                                            <span id={`settle-sub-${c.key}`} className="-mt-2.5 pb-1 pl-[27px] text-xs font-medium">
                                                {c.settleSub}
                                            </span>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        );
                    }
                    return (
                        <button
                            key={c.key}
                            type="button"
                            disabled={locked || pending}
                            onClick={() => activate(c.key)}
                            // Full content for screen readers (name, people, balance), no emoji.
                            aria-label={`Cambiar a ${c.name}. ${c.sub}. ${c.label}: ${c.signed ?? c.amount}`}
                            className="snap-center flex-none w-[156px] min-h-[150px] rounded-[22px] bg-card text-foreground border border-[color:var(--line)] p-4 flex flex-col justify-between gap-2 text-left transition-[width,opacity] duration-250 disabled:opacity-60 active:scale-[0.98]"
                        >
                            {body}
                            <span className="truncate text-xs text-muted-foreground">{c.sub}</span>
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center justify-between px-5 pt-1">
                <div className="flex gap-[5px]" aria-hidden="true">
                    {cards.map((c) => (
                        <span
                            key={c.key}
                            className={cn(
                                "h-1 rounded-sm transition-all duration-250",
                                c.key === activeKey ? "w-4 bg-foreground" : "w-1 bg-[var(--ink-4)]",
                            )}
                        />
                    ))}
                </div>
                {spacesHref && (
                    <Link href={spacesHref} className="min-h-11 -mr-2 px-2 flex items-center text-[13px] font-semibold text-primary">
                        Ver espacios
                    </Link>
                )}
            </div>
        </section>
    );
}
