"use client";

import { useEffect, useRef } from "react";
import { EqCard, EqCta, EqHeader, EqLabel } from "@/components/ui/eq";

/**
 * Full-screen "Más opciones" panel over the add-expense form. Keeps the advanced
 * controls (custom split, receipt lines, date, tags, recurrence, notes) one tap
 * away without crowding the numpad screen.
 */
export function MoreOptionsSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        ref.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <dialog
            ref={ref}
            open
            tabIndex={-1}
            aria-modal="true"
            aria-label="Más opciones"
            className="eq-in fixed inset-0 z-40 m-0 h-full max-h-none w-full max-w-none border-0 p-0 bg-background text-foreground overflow-y-auto outline-none sm:max-w-md sm:mx-auto"
        >
            <div className="min-h-full flex flex-col pt-3">
                <EqHeader title="Más opciones" onBack={onClose} />
                <div className="flex-1 flex flex-col gap-5 px-5 pt-5 pb-4">{children}</div>
                <div className="sticky bottom-0 px-5 pt-3 pb-[30px] bg-background">
                    <EqCta onClick={onClose}>Listo</EqCta>
                </div>
            </div>
        </dialog>
    );
}

/** A labelled white card section inside the sheet. */
export function OptionSection({
    label,
    aside,
    children,
    htmlFor,
}: {
    label: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
    htmlFor?: string;
}) {
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
                {htmlFor ? (
                    <label htmlFor={htmlFor}><EqLabel>{label}</EqLabel></label>
                ) : (
                    <EqLabel>{label}</EqLabel>
                )}
                {aside}
            </div>
            <EqCard className="p-3.5">{children}</EqCard>
        </section>
    );
}
