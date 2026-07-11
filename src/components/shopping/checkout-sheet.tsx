"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/category/category-picker";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { CategoryContext } from "@/lib/category-context";
import type { ShoppingItem } from "./shopping-item-row";

interface Member {
    id: string;
    name: string;
}

interface CheckoutSheetProps {
    open: boolean;
    onClose: () => void;
    listName: string;
    items: ShoppingItem[];
    totalCents: number;
    /** Empty for personal lists (no payer/split). */
    members: Member[];
    currentUserId: string;
    categoryContext: CategoryContext;
    /** POST target, e.g. `/api/spaces/[id]/lists/[listId]/checkout` or `/api/me/lists/[listId]/checkout`. */
    endpoint: string;
    onDone: () => void;
}

/**
 * Bottom-sheet for the list→expense bridge: shows the eligible (checked + priced)
 * items, the total, a payer selector (group only) and the CategoryPicker. Confirm
 * POSTs to the checkout endpoint, which materializes ONE expense idempotently.
 */
export function CheckoutSheet({
    open,
    onClose,
    listName,
    items,
    totalCents,
    members,
    currentUserId,
    categoryContext,
    endpoint,
    onDone,
}: CheckoutSheetProps) {
    const [category, setCategory] = useState("");
    const [paidById, setPaidById] = useState(currentUserId);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const isGroup = members.length > 0;

    const handleConfirm = async () => {
        if (submitting || !category) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(isGroup ? { category, paidById } : { category }),
            });
            if (res.ok) {
                onDone();
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error ?? "No se pudo crear el gasto.");
            }
        } catch {
            setError("No se pudo crear el gasto.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
            <div className="relative w-full max-w-md bg-background rounded-t-2xl border-t border-x border-[color:var(--line)] p-4 space-y-4 max-h-[85vh] overflow-y-auto pb-8">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-foreground">Convertir en gasto</h2>
                    <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="rounded-xl border border-[color:var(--line)] bg-card p-3 space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {items.length} artículo{items.length === 1 ? "" : "s"} · {listName}
                    </p>
                    {items.map((it) => (
                        <div key={it.id} className="flex justify-between text-sm">
                            <span className="text-foreground truncate mr-2">{it.name}</span>
                            <span className="text-muted-foreground shrink-0">{formatCurrency(it.priceCents ?? 0)}</span>
                        </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[color:var(--line)] mt-1.5">
                        <span className="text-foreground">Total</span>
                        <span className="text-foreground">{formatCurrency(totalCents)}</span>
                    </div>
                </div>

                {isGroup && (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">¿Quién pagó?</p>
                        <div className="flex flex-wrap gap-2">
                            {members.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => setPaidById(m.id)}
                                    aria-pressed={paidById === m.id}
                                    className={cn(
                                        "rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors",
                                        paidById === m.id
                                            ? "bg-primary text-white border-primary"
                                            : "bg-card text-muted-foreground border-[color:var(--line)]",
                                    )}
                                >
                                    {m.name}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground/70">Se repartirá a partes iguales entre los miembros.</p>
                    </div>
                )}

                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Categoría</p>
                    <CategoryPicker context={categoryContext} value={category} onChange={setCategory} />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button className="w-full" onClick={handleConfirm} isLoading={submitting} disabled={!category}>
                    Crear gasto de {formatCurrency(totalCents)}
                </Button>
            </div>
        </div>
    );
}
