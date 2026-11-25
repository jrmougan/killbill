"use client";

import { Button } from "@/components/ui/button";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { formatCurrency } from "@/lib/currency";
import { Users } from "lucide-react";
import { useState } from "react";
import { useApiMutation } from "@/hooks/use-api-mutation";

/**
 * Promote a PERSONAL expense to a SHARED (group) one. Wires the existing
 * POST /api/expenses/[id]/share endpoint (N-way, splits + ledger). Shown only for
 * a personal expense whose owner belongs to a group. The confirmation names the
 * expense and the space and spells out the balance effect of the default split
 * (`effect`, computed server-side with the same split the endpoint uses). It
 * posts the previewed `targetGroupId`, so switching the active space in another
 * tab can't share it somewhere else. There is no way back to PERSONAL.
 */
export function PromoteButton({
    expenseId,
    description,
    amount,
    targetGroupId,
    spaceName,
    effect,
    itemized = false,
}: {
    expenseId: string;
    description: string;
    /** Total in cents. */
    amount: number;
    /** The space the preview was computed for. */
    targetGroupId: string;
    spaceName: string;
    effect: string[];
    /** The receipt lines carry assignees: the split follows them, not halves. */
    itemized?: boolean;
}) {
    const { mutate, pending: loading, refreshing, error } = useApiMutation();
    const [showConfirm, setShowConfirm] = useState(false);

    const handlePromote = async () => {
        const res = await mutate(`/api/expenses/${expenseId}/share`, {
            body: { targetGroupId },
            errorMessage: "No se pudo compartir el gasto",
            networkErrorMessage: "Error de conexión",
        });
        if (res.ok) setShowConfirm(false);
    };

    const consequences: React.ReactNode[] = [
        ...effect.map((line) => <span key={line} className="font-semibold text-foreground">{line}</span>),
        itemized
            ? `Se reparte por productos, según el ticket, y cuenta en el saldo de ${spaceName}.`
            : `Se reparte a partes iguales entre los miembros de ${spaceName} y cuenta en el saldo.`,
        "Dejará de ser privado: lo verán todos.",
        "No podrás volver a hacerlo privado; solo eliminarlo.",
    ];

    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Compartir con el grupo"
                aria-haspopup="dialog"
                className="-my-1 h-11 w-11 rounded-full text-primary hover:text-primary hover:bg-[var(--accent-tint)]"
                onClick={() => setShowConfirm(true)}
                disabled={loading || refreshing}
                data-testid="expense-promote"
            >
                <Users className="h-4 w-4" />
            </Button>
            {showConfirm && (
                <CriticalActionSheet
                    title={`¿Compartir «${description}» con ${spaceName}?`}
                    facts={[{ label: "Importe", value: formatCurrency(amount), emphasis: true }]}
                    consequences={consequences}
                    confirmLabel={`Compartir con ${spaceName}`}
                    reversible={false}
                    busy={loading || refreshing}
                    error={error}
                    onConfirm={handlePromote}
                    onClose={() => setShowConfirm(false)}
                    testId="expense-promote-sheet"
                    confirmTestId="expense-promote-confirm"
                />
            )}
        </>
    );
}
