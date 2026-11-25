"use client";

import { useEffect, useRef } from "react";
import { EqCard, EqCta, EqHeader, EqLabel } from "@/components/ui/eq";

/**
 * Full-screen "Más opciones" panel over the expense form. Keeps the advanced
 * controls (custom split, receipt lines, date, tags, recurrence, notes) one tap
 * away without crowding the numpad screen.
 *
 * A native MODAL `<dialog>` (`showModal()`, T-06/G-21): the browser traps focus
 * inside it, makes the form behind inert, closes on Escape (→ onClose) and
 * returns focus to the opener when it closes.
 */
export function MoreOptionsSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (!dialog.open) {
            if (typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
        }
        return () => {
            if (dialog.open) dialog.close();
        };
    }, []);

    return (
        <dialog
            ref={ref}
            aria-labelledby="more-options-title"
            data-testid="more-options"
            onCancel={(e) => {
                // Escape: let React own the unmount instead of the UA closing it.
                e.preventDefault();
                onCloseRef.current();
            }}
            className="eq-in fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 p-0 bg-background text-foreground overflow-y-auto outline-none backdrop:bg-black/35 sm:max-w-md sm:mx-auto"
        >
            <div className="min-h-full flex flex-col pt-3">
                <EqHeader onBack={() => onCloseRef.current()}>
                    <h2 id="more-options-title" className="text-2xl font-bold tracking-[-0.02em] flex-1 min-w-0 truncate">Más opciones</h2>
                </EqHeader>
                <div className="flex-1 flex flex-col gap-5 px-5 pt-5 pb-4">{children}</div>
                <div className="sticky bottom-0 px-5 pt-3 pb-[30px] bg-background">
                    <EqCta onClick={() => onCloseRef.current()}>Listo</EqCta>
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
