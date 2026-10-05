"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";

/**
 * EQUIL confirmation bottom sheet (replaces `window.confirm` on the space
 * screens). `error` shows inline; `errorHref` adds a way out (e.g. "Ir a
 * liquidar" when archiving is blocked by open balances).
 */
export function ConfirmSheet({
    title,
    children,
    confirmLabel,
    tone = "primary",
    busy = false,
    error,
    errorHref,
    errorHrefLabel = "Ir a liquidar",
    onConfirm,
    onClose,
    testId,
}: {
    title: string;
    children?: React.ReactNode;
    confirmLabel: string;
    tone?: "primary" | "danger";
    busy?: boolean;
    error?: string | null;
    errorHref?: string | null;
    errorHrefLabel?: string;
    onConfirm: () => void;
    onClose: () => void;
    testId?: string;
}) {
    return (
        <Sheet title={title} onClose={onClose}>
            <div className="flex flex-col gap-4" data-testid={testId}>
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
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={busy}
                    data-testid="confirm-sheet-confirm"
                    className={cn(
                        "h-14 rounded-[18px] text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]",
                        tone === "danger" ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
                    )}
                >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {confirmLabel}
                </button>
                <button type="button" onClick={onClose} className="h-11 text-sm font-semibold text-muted-foreground">
                    Cancelar
                </button>
            </div>
        </Sheet>
    );
}
