"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * Small bottom sheet (EQUIL style): a native modal `<dialog>` (focus trap,
 * Escape and top layer for free) anchored to the bottom, dimmed backdrop that
 * closes on tap. `title` labels the dialog; without it pass `label` and render
 * your own heading inside.
 */
export function Sheet({
    title,
    label,
    onClose,
    children,
}: {
    title?: string;
    label?: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const titleId = useId();
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
        // Keyboard users close with Escape (onCancel) or the Cerrar button; the
        // click handler only adds tap-on-backdrop dismissal.
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <dialog
            ref={ref}
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : label}
            onCancel={(e) => {
                // Escape: let React own the unmount instead of the UA closing it.
                e.preventDefault();
                onCloseRef.current();
            }}
            onClick={(e) => {
                // A click on the dialog box itself (not its content) is the backdrop.
                if (e.target === e.currentTarget) onCloseRef.current();
            }}
            className="eq-in fixed inset-x-0 bottom-0 top-auto m-0 mx-auto w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-[24px] bg-card p-0 text-foreground backdrop:bg-black/35"
        >
            <div className="px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
                <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--ink-4)]" aria-hidden />
                <div className="flex items-center gap-2 mb-4">
                    {title ? (
                        <h2 id={titleId} className="flex-1 text-[17px] font-bold tracking-[-0.01em]">
                            {title}
                        </h2>
                    ) : (
                        <span className="flex-1" />
                    )}
                    <button
                        type="button"
                        onClick={() => onCloseRef.current()}
                        aria-label="Cerrar"
                        className="h-8 w-8 -mr-1 flex items-center justify-center text-muted-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
        </dialog>
    );
}

/** 48px white text field with a visible label, matching the add-item input. */
export function SheetField({
    label,
    ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
    const id = useId();
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-xs font-semibold text-muted-foreground pl-1">
                {label}
            </label>
            <input
                id={id}
                {...props}
                className="h-12 rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-[color:var(--accent-border)] disabled:opacity-60"
            />
        </div>
    );
}
