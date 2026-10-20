"use client";

import { Button } from "@/components/ui/button";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { formatCurrency } from "@/lib/currency";
import { setFlashToast } from "@/lib/flash-toast";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteEffectLines, type DeleteEffectSplit } from "./delete-effect";

interface DeleteExpenseButtonProps {
    expenseId: string;
    description: string;
    /** Total in cents. */
    amount: number;
    /** Shared expenses carry their space; personal ones have none. */
    coupleId: string | null;
    viewerId: string;
    payer: { id: string; name: string };
    splits: DeleteEffectSplit[];
    /** The expense is the template of an active recurring series. */
    isRecurringTemplate?: boolean;
    /** Where to go after deleting (keeps the Común/Personal context — G-24/T-05). */
    redirectTo?: string;
}

/**
 * Delete with a danger `CriticalActionSheet` (alertdialog, focus on Cancelar,
 * Escape cancels): names the expense and amount, spells out the balance effect
 * for the viewer and warns that a recurring template stops generating.
 */
export function DeleteExpenseButton({
    expenseId,
    description,
    amount,
    coupleId,
    viewerId,
    payer,
    splits,
    isRecurringTemplate = false,
    redirectTo = "/expenses/list",
}: DeleteExpenseButtonProps) {
    const router = useRouter();
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const personal = !coupleId;

    const handleDelete = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/expenses/${expenseId}`, { method: "DELETE" });
            if (res.ok) {
                setFlashToast(
                    `Gasto «${description}» eliminado · saldo actualizado`,
                    coupleId ? { label: "Saldar deuda", href: `/settle?space=${encodeURIComponent(coupleId)}` } : undefined,
                );
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

    // The balance effect leads, in ink: it is what the person is deciding on.
    const consequences: React.ReactNode[] = deleteEffectLines({ viewerId, payer, splits, personal })
        .map((line) => <span key={line} className="font-semibold text-foreground">{line}</span>);
    if (!personal) {
        consequences.push("Si ya saldasteis esta deuda, el saldo cambiará y puede que tengáis que saldar deuda de nuevo.");
    }
    if (isRecurringTemplate) {
        consequences.push("Al eliminarlo dejarán de crearse los próximos. Los ya creados se mantienen.");
    }

    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar"
                aria-haspopup="dialog"
                className="-my-1 h-11 w-11 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => { setError(null); setShowConfirm(true); }}
                data-testid="expense-delete"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
            {showConfirm && (
                <CriticalActionSheet
                    title={`¿Eliminar «${description}» de ${formatCurrency(amount)}?`}
                    consequences={consequences}
                    reversible={false}
                    tone="danger"
                    confirmLabel={isRecurringTemplate ? "Eliminar y detener recurrencia" : "Eliminar gasto"}
                    busy={loading}
                    error={error}
                    onConfirm={handleDelete}
                    onClose={() => setShowConfirm(false)}
                    testId="expense-delete-sheet"
                />
            )}
        </>
    );
}
