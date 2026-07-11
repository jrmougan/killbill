"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    onCancel?: () => void;
}

/**
 * Delete-with-reassignment modal (Fase 4). Reassignment is MANDATORY (decision
 * #7): the user must pick where existing expenses/budgets move, prefilled to
 * `other`. A Budget unique collision comes back as 409 (decision #3) and is shown
 * as an actionable message — nothing is deleted until it's resolved.
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

    const handleDelete = async () => {
        if (!reassignTo) {
            setError("Elige una categoría destino");
            return;
        }
        setDeleting(true);
        setError(null);
        try {
            const endpoint = categoriesEndpoint(context);
            const url = `${endpoint}?id=${encodeURIComponent(category.id)}&reassignTo=${encodeURIComponent(reassignTo)}`;
            const res = await fetch(url, { method: "DELETE" });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                setError(json?.error || "No se pudo borrar la categoría");
                return;
            }
            onDeleted?.();
        } catch {
            setError("Error de conexión. Inténtalo de nuevo.");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[var(--negative-tint)] border border-[color:var(--negative)]/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="min-w-0">
                    <h3 className="font-bold text-foreground">Borrar categoría</h3>
                    <p className="text-sm text-muted-foreground">
                        Los gastos y presupuestos de <span className="font-semibold text-foreground">{category.label}</span> se moverán a la categoría que elijas.
                    </p>
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor="reassign-target" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Reasignar a
                </label>
                <div className="flex items-center gap-2">
                    <CategoryBadge
                        meta={targets.find((c) => c.id === reassignTo)}
                        variant="emoji"
                        size={36}
                        radius={9}
                    />
                    <select
                        id="reassign-target"
                        value={reassignTo}
                        onChange={(e) => setReassignTo(e.target.value)}
                        className="flex-1 bg-card border border-[color:var(--line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent-border)]"
                    >
                        {targets.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.emoji} {c.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {error && (
                <div role="alert" className="rounded-xl bg-[var(--negative-tint)] border border-[color:var(--negative)]/30 px-3 py-2.5 text-sm text-destructive">
                    {error}
                </div>
            )}

            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    onClick={handleDelete}
                    disabled={deleting || !reassignTo}
                >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Borrar y reasignar"}
                </Button>
                {onCancel && (
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancelar
                    </Button>
                )}
            </div>
        </div>
    );
}
