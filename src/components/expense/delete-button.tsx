"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

interface DeleteExpenseButtonProps {
    expenseId: string;
    /** Where to go after deleting (keeps the Común/Personal context — G-24/T-05). */
    redirectTo?: string;
}

/**
 * Delete with confirmation. The confirmation is a native modal `<dialog>`
 * (`showModal()`, role="alertdialog", G-23): focus is trapped and starts on
 * "Cancelar", Escape cancels, and focus returns to the trash button.
 */
export function DeleteExpenseButton({ expenseId, redirectTo = "/expenses/list" }: DeleteExpenseButtonProps) {
    const router = useRouter();
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/expenses/${expenseId}`, { method: "DELETE" });
            if (res.ok) {
                router.push(redirectTo);
                router.refresh();
                return;
            }
            const body = await res.json().catch(() => null);
            setError(body?.error || "No se pudo eliminar el gasto.");
        } catch (err) {
            console.error(err);
            setError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar"
                aria-haspopup="dialog"
                className="h-9 w-9 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => { setError(null); setShowConfirm(true); }}
                data-testid="expense-delete"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
            {showConfirm && (
                <ConfirmDialog
                    loading={loading}
                    error={error}
                    onCancel={() => { if (!loading) setShowConfirm(false); }}
                    onConfirm={handleDelete}
                />
            )}
        </>
    );
}

function ConfirmDialog({ loading, error, onCancel, onConfirm }: {
    loading: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const descId = useId();
    const onCancelRef = useRef(onCancel);
    useEffect(() => {
        onCancelRef.current = onCancel;
    }, [onCancel]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (!dialog.open) {
            if (typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
        }
        cancelRef.current?.focus();
        return () => {
            if (dialog.open) dialog.close();
        };
    }, []);

    return (
        <dialog
            ref={ref}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            onCancel={(e) => {
                e.preventDefault();
                onCancelRef.current();
            }}
            className="m-auto w-[calc(100%-48px)] max-w-sm rounded-[18px] border border-[color:var(--line)] bg-card p-6 text-foreground backdrop:bg-black/40"
        >
            <div className="space-y-4">
                <div className="text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-[var(--negative-tint)] flex items-center justify-center mx-auto">
                        <Trash2 className="h-6 w-6 text-destructive" aria-hidden />
                    </div>
                    <h2 id={titleId} className="text-lg font-bold">¿Eliminar gasto?</h2>
                    <p id={descId} className="text-sm text-muted-foreground">
                        Esta acción no se puede deshacer. El gasto se eliminará permanentemente.
                    </p>
                </div>
                {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
                <div className="flex gap-3">
                    <Button ref={cancelRef} variant="secondary" className="flex-1" onClick={() => onCancelRef.current()} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={onConfirm}
                        isLoading={loading}
                        data-testid="expense-delete-confirm"
                    >
                        Eliminar
                    </Button>
                </div>
            </div>
        </dialog>
    );
}
