"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
} from "@/lib/category-context";
import { CategoryBadge } from "./category-badge";

interface DeleteCategoryModalProps {
    context: CategoryContext;
    /** The custom category being deleted (never a system row). */
    category: CategoryListItem;
    /** Full effective list; reassignment targets = everything except the deleted one. */
    categories: CategoryListItem[];
    onDeleted?: () => void;
    onCancel: () => void;
}

/**
 * Delete-with-reassignment sheet (Fase 4, CF-24). Reassignment is MANDATORY
 * (decision #7): the user picks where existing expenses, recurring expenses and
 * budgets move, prefilled to `other`. A Budget unique collision comes back as
 * 409 `BUDGET_CONFLICT` (decision #3) and is shown with two ways out — pick
 * another target or go to Presupuestos — and nothing is deleted until then.
 */
export function DeleteCategoryModal({
    context,
    category,
    categories,
    onDeleted,
    onCancel,
}: DeleteCategoryModalProps) {
    const targets = categories.filter((c) => c.id !== category.id);
    const defaultTarget =
        targets.find((c) => c.key === "other")?.id ?? targets[0]?.id ?? "";
    const [reassignTo, setReassignTo] = useState(defaultTarget);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Target whose budget clashed (409 BUDGET_CONFLICT), shown with its ways out.
    const [conflictWith, setConflictWith] = useState<string | null>(null);
    const selectRef = useRef<HTMLSelectElement>(null);
    const target = targets.find((c) => c.id === reassignTo);
    const budgetsHref = context.kind === "personal" ? "/month?view=budget&scope=personal" : "/month?view=budget";

    const handleDelete = async () => {
        if (!reassignTo) {
            setError("Elige una categoría destino");
            return;
        }
        setDeleting(true);
        setError(null);
        setConflictWith(null);
        try {
            const endpoint = categoriesEndpoint(context);
            const url = `${endpoint}?id=${encodeURIComponent(category.id)}&reassignTo=${encodeURIComponent(reassignTo)}`;
            const res = await fetch(url, { method: "DELETE" });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                if (json?.code === "BUDGET_CONFLICT") setConflictWith(target?.label ?? "La categoría destino");
                else setError(json?.error || "No se pudo eliminar la categoría");
                return;
            }
            onDeleted?.();
        } catch {
            setError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            setDeleting(false);
        }
    };

    const chooseAnother = () => {
        setConflictWith(null);
        selectRef.current?.focus();
    };

    return (
        <CriticalActionSheet
            tone="danger"
            testId="category-delete-sheet"
            title={`¿Eliminar la categoría «${category.label}»?`}
            consequences={[
                `Los gastos, gastos recurrentes y presupuestos de «${category.label}» pasarán a la categoría que elijas.`,
            ]}
            reversible={false}
            confirmLabel={target ? `Eliminar y mover a «${target.label}»` : "Eliminar categoría"}
            confirmDisabled={!reassignTo || conflictWith !== null}
            busy={deleting}
            error={error}
            onConfirm={handleDelete}
            onClose={onCancel}
        >
            <div className="space-y-2">
                <label htmlFor="reassign-target" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Mover a
                </label>
                <div className="flex items-center gap-2">
                    <CategoryBadge meta={target} variant="emoji" size={44} radius={12} />
                    <select
                        id="reassign-target"
                        ref={selectRef}
                        value={reassignTo}
                        onChange={(e) => {
                            setReassignTo(e.target.value);
                            setConflictWith(null);
                            setError(null);
                        }}
                        className="h-11 min-w-0 flex-1 bg-card border border-[color:var(--line)] rounded-[12px] px-3 text-[15px] text-foreground focus:outline-none focus:border-[color:var(--accent-border)] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {targets.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.emoji} {c.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {conflictWith && (
                <div role="alert" data-testid="category-budget-conflict" className="mt-4 rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm text-foreground">
                    <p className="[overflow-wrap:anywhere]">
                        «{conflictWith}» ya tiene presupuesto en un mes en que «{category.label}» también lo tiene, y no se
                        pueden juntar. Elige otro destino o quita uno de los dos presupuestos.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-5">
                        <button type="button" onClick={chooseAnother} className="min-h-11 flex items-center font-semibold text-primary">
                            Elegir otro destino
                        </button>
                        <Link href={budgetsHref} className="min-h-11 flex items-center font-semibold text-primary">
                            Ir a Presupuestos →
                        </Link>
                    </div>
                </div>
            )}
        </CriticalActionSheet>
    );
}
