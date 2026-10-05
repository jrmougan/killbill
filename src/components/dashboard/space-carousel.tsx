"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, Clock } from "lucide-react";
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
    /** "Quedar en paz" target (active, shared, open balance); null hides it. */
    settleHref: string | null;
    /** A payment I sent is waiting for confirmation (debtor side). */
    pendingNote?: string | null;
};

/**
 * Horizontal space carousel (prototype `is.home`): the active card is wide and
 * green; tapping another card switches the active space via the existing
 * active-group mechanism. Dots + "Ver espacios" sit underneath.
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
                    const body = (
                        <>
                            {/* Title and subtitle on their own lines so neither is cut to "Perso…". */}
                            <div className="min-w-0 text-sm font-semibold">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span aria-hidden="true" className="flex-none">{c.emoji}</span>
                                    <span className="truncate">{c.name}</span>
                                </div>
                                <div className="truncate text-xs font-medium opacity-75">{c.sub}</div>
                            </div>
                            <div className="min-w-0">
                                <div className="text-[13px] opacity-80 truncate">{c.label}</div>
                                <div
                                    aria-hidden={c.signed ? true : undefined}
                                    className={cn(
                                        "font-bold tracking-[-0.03em] leading-[1.05] truncate",
                                        active ? "text-[34px]" : "text-[22px]",
                                        !active && c.tone === "positive" && "text-[color:var(--positive)]",
                                        !active && c.tone === "negative" && "text-[color:var(--negative)]",
                                    )}
                                >
                                    {c.amount}
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
                                className="snap-center flex-none w-[248px] min-h-[150px] rounded-[22px] bg-primary text-primary-foreground border border-primary p-4 flex flex-col justify-between gap-2 transition-[width,background-color] duration-250"
                            >
                                {body}
                                {c.pendingNote ? (
                                    <Link
                                        href={c.settleHref ?? "/settle"}
                                        data-testid="pending-out-note"
                                        className="-my-2 -ml-1 self-start min-h-11 px-1 flex items-center gap-1.5 text-[13px] font-semibold"
                                    >
                                        <Clock className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                                        <span className="line-clamp-2">{c.pendingNote}</span>
                                    </Link>
                                ) : c.settleHref ? (
                                    <Link
                                        href={c.settleHref}
                                        className="-my-2 -ml-1 self-start min-h-11 px-1 flex items-center gap-1.5 text-[13px] font-semibold"
                                    >
                                        <Check className="h-[15px] w-[15px]" aria-hidden="true" />
                                        Quedar en paz
                                    </Link>
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
