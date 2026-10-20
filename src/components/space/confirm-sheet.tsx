"use client";

import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";

/**
 * EQUIL confirmation bottom sheet for the space screens. Thin wrapper over
 * `CriticalActionSheet` (same testids, same behaviour); new confirmations
 * should use that one directly to get facts/consequences. `error` shows
 * inline; `errorHref` adds a way out (e.g. "Saldar deudas" when archiving is
 * blocked by open balances).
 */
export function ConfirmSheet({
    title,
    children,
    confirmLabel,
    tone = "primary",
    busy = false,
    error,
    errorHref,
    errorHrefLabel = "Saldar deudas",
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
        <CriticalActionSheet
            title={title}
            confirmLabel={confirmLabel}
            tone={tone}
            busy={busy}
            error={error}
            errorHref={errorHref}
            errorHrefLabel={errorHrefLabel}
            onConfirm={onConfirm}
            onClose={onClose}
            testId={testId}
        >
            {children}
        </CriticalActionSheet>
    );
}
