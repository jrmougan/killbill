"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";

export type CriticalFact = { label: string; value: React.ReactNode; emphasis?: boolean };

export type CriticalSecondary = { label: string; tone?: "primary" | "danger" } & (
    | { href: string; onClick?: never }
    | { onClick: () => void; href?: never }
);

/**
 * EQUIL critical-action sheet (docs/ux/plan-acciones-criticas.md §2): the
 * single review step before money moves, data is lost or someone is removed.
 * `title` asks about the concrete object; `facts` are the QUIÉN/CUÁNTO rows,
 * `consequences` the concrete effects and `reversible={false}` adds "No se
 * puede deshacer.". `tone="danger"` paints the CTA red and turns the sheet
 * into an `alertdialog` whose initial focus is Cancelar. While `busy` it
 * cannot be dismissed. `error` is the server answer (e.g. a 409) and is shown
 * even if the UI already disabled the CTA; `errorHref` adds a way out.
 */
export function CriticalActionSheet({
    title,
    facts,
    consequences,
    reversible = true,
    tone = "primary",
    confirmLabel,
    confirmDisabled = false,
    disabledReason,
    cancelLabel = "Cancelar",
    secondary,
    children,
    busy = false,
    error,
    errorHref,
    errorHrefLabel = "Saldar deudas",
    onConfirm,
    onClose,
    testId,
    confirmTestId = "confirm-sheet-confirm",
}: {
    title: string;
    facts?: CriticalFact[];
    consequences?: React.ReactNode[];
    reversible?: boolean;
    tone?: "primary" | "danger";
    confirmLabel: string;
    confirmDisabled?: boolean;
    disabledReason?: string | null;
    cancelLabel?: string;
    secondary?: CriticalSecondary;
    children?: React.ReactNode;
    busy?: boolean;
    error?: string | null;
    errorHref?: string | null;
    errorHrefLabel?: string;
    onConfirm: () => void;
    onClose: () => void;
    testId?: string;
    /** Keeps a pre-existing CTA testid when a confirmation migrates here. */
    confirmTestId?: string;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const danger = tone === "danger";

    // Runs after Sheet's own effect has called showModal(), so it overrides the
    // UA's "first focusable" choice: a destructive sheet starts on Cancelar.
    useEffect(() => {
        if (danger) cancelRef.current?.focus();
    }, [danger]);

    const close = () => {
        if (!busy) onClose();
    };
    const reasonShown = confirmDisabled && !!disabledReason;
    const secondaryCls = cn(
        "min-h-11 flex items-center justify-center text-sm font-semibold",
        secondary?.tone === "danger" ? "text-destructive" : "text-primary",
    );

    return (
        <Sheet title={title} onClose={close} dismissible={!busy} role={danger ? "alertdialog" : "dialog"}>
            <div className="flex flex-col gap-4" data-testid={testId} aria-busy={busy || undefined}>
                {facts && facts.length > 0 && (
                    <dl className="rounded-[14px] bg-[var(--track)] px-3.5 py-1 divide-y divide-[color:var(--line-2)]">
                        {facts.map((f) => (
                            <div key={f.label} className="flex items-baseline justify-between gap-3 py-2.5">
                                <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
                                <dd
                                    className={cn(
                                        "text-right tabular-nums [overflow-wrap:anywhere]",
                                        f.emphasis ? "text-[17px] font-bold" : "text-[15px] font-semibold",
                                    )}
                                >
                                    {f.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
                {((consequences && consequences.length > 0) || !reversible) && (
                    <ul className="flex flex-col gap-1.5 text-[15px] text-muted-foreground leading-[1.45]">
                        {consequences?.map((c, i) => <li key={i}>{c}</li>)}
                        {!reversible && <li className="font-semibold text-foreground">No se puede deshacer.</li>}
                    </ul>
                )}
                {children && <div className="text-[15px] text-muted-foreground leading-[1.45]">{children}</div>}
                {error && (
                    <div role="alert" data-testid="confirm-sheet-error" className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm text-foreground">
                        <p>{error}</p>
                        {errorHref && (
                            <Link href={errorHref} className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary">
                                {errorHrefLabel} →
                            </Link>
                        )}
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy || confirmDisabled}
                        aria-describedby={reasonShown ? `${testId ?? "confirm-sheet"}-reason` : undefined}
                        data-testid={confirmTestId}
                        className={cn(
                            "h-14 rounded-[18px] text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]",
                            danger ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
                        )}
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {confirmLabel}
                    </button>
                    {reasonShown && (
                        <p id={`${testId ?? "confirm-sheet"}-reason`} data-testid="confirm-sheet-reason" className="text-center text-[13px] text-muted-foreground">
                            {disabledReason}
                        </p>
                    )}
                </div>
                {secondary &&
                    (secondary.href ? (
                        <Link href={secondary.href} className={secondaryCls}>
                            {secondary.label}
                        </Link>
                    ) : (
                        <button type="button" onClick={secondary.onClick} disabled={busy} className={secondaryCls}>
                            {secondary.label}
                        </button>
                    ))}
                <button
                    ref={cancelRef}
                    type="button"
                    onClick={close}
                    disabled={busy}
                    data-testid="confirm-sheet-cancel"
                    className="h-11 text-sm font-semibold text-muted-foreground disabled:opacity-50"
                >
                    {cancelLabel}
                </button>
            </div>
        </Sheet>
    );
}
