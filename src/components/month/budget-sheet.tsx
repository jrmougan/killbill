"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { EqCta } from "@/components/ui/eq";
import { CategoryGlyph } from "./category-glyph";
import type { MonthCategory } from "./types";

/**
 * Small bottom sheet to set a category's monthly limit (add or edit). The
 * prototype's "+ 100 €" one-tap is a demo shortcut — the user always types the
 * amount. `onDelete` (edit only) adds the "Eliminar" action.
 */
export function BudgetSheet({
    category,
    initialValue,
    saving,
    error,
    onSave,
    onDelete,
    onClose,
}: {
    category: MonthCategory;
    initialValue: string;
    saving: boolean;
    error: string | null;
    onSave: (value: string) => void;
    onDelete?: () => void;
    onClose: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    // "Eliminar presupuesto" asks first (one tap must never delete).
    const [confirmDelete, setConfirmDelete] = useState(false);
    const titleId = useId();
    const inputId = useId();
    const ref = useRef<HTMLDialogElement>(null);

    // Native modal dialog: top layer, focus trap, inert background and Escape
    // (→ `cancel`) for free. Environments without showModal (jsdom) just open it.
    useEffect(() => {
        const el = ref.current;
        if (!el || el.open) return;
        if (typeof el.showModal === "function") el.showModal();
        else el.setAttribute("open", "");
    }, []);

    // Tapping the backdrop dismisses (a mouse/touch nicety — keyboard users have
    // Escape and the "Cerrar" button). A click whose target is the <dialog>
    // itself landed outside the padded content, i.e. on ::backdrop.
    const dismiss = useRef(() => {});
    dismiss.current = () => { if (!saving) onClose(); };
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onClick = (e: MouseEvent) => { if (e.target === el) dismiss.current(); };
        el.addEventListener("click", onClick);
        return () => el.removeEventListener("click", onClick);
    }, []);

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            onCancel={(e) => { e.preventDefault(); dismiss.current(); }}
            className="eq-in mt-auto mb-0 mx-auto w-full max-w-none sm:max-w-md p-0 border-0 rounded-t-[24px] bg-background text-foreground backdrop:bg-black/30"
        >
            <div className="px-5 pt-5 pb-[max(env(safe-area-inset-bottom),20px)] flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                    <h2 id={titleId} className="flex-1 text-lg font-bold flex items-center gap-2 min-w-0">
                        <CategoryGlyph category={category} />
                        <span className="truncate">{category.label}</span>
                    </h2>
                    <button
                        type="button"
                        aria-label="Cerrar"
                        disabled={saving}
                        onClick={onClose}
                        className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-card"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {/* noValidate: our own check gives the actionable Spanish message
                    instead of the browser's min/step tooltip. */}
                <form
                    noValidate
                    className="flex flex-col gap-4"
                    onSubmit={(e) => { e.preventDefault(); onSave(value); }}
                >
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={inputId} className="text-xs font-semibold text-muted-foreground">
                            Importe del presupuesto
                        </label>
                        <div className="flex items-baseline gap-2 rounded-[14px] bg-card border border-[color:var(--line)] px-4 py-3 focus-within:border-primary">
                            <input
                                id={inputId}
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                maxLength={16}
                                placeholder="0"
                                aria-invalid={error ? true : undefined}
                                aria-describedby={`${inputId}-hint`}
                                disabled={saving}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                className="flex-1 min-w-0 bg-transparent text-[32px] font-bold tracking-[-0.03em] leading-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet exists to type this amount
                                autoFocus
                            />
                            <span className="text-xl font-semibold text-muted-foreground">€</span>
                        </div>
                        <p id={`${inputId}-hint`} className="text-[12.5px] text-muted-foreground">
                            Límite mensual para esta categoría (máx. 1.000.000 €)
                        </p>
                        {error && <p role="alert" className="text-[13px] text-[color:var(--negative)]">{error}</p>}
                    </div>
                    {confirmDelete && onDelete ? (
                        <fieldset
                            aria-describedby={`${inputId}-confirm`}
                            className="m-0 min-w-0 border-0 flex flex-col gap-3 rounded-[14px] bg-[var(--negative-tint)] p-3.5"
                        >
                            <legend className="sr-only">Confirmar eliminación</legend>
                            <p id={`${inputId}-confirm`} className="text-sm">
                                ¿Eliminar el presupuesto de <strong>{category.label}</strong>? Dejarás de ver su límite
                                este mes; tus gastos no cambian.
                            </p>
                            <div className="flex gap-2.5">
                                <EqCta
                                    variant="outline"
                                    className="flex-1 h-11 rounded-2xl text-[15px]"
                                    disabled={saving}
                                    onClick={() => setConfirmDelete(false)}
                                >
                                    Cancelar
                                </EqCta>
                                <EqCta
                                    className="flex-1 h-11 rounded-2xl text-[15px] bg-destructive"
                                    disabled={saving}
                                    onClick={onDelete}
                                >
                                    Sí, eliminar
                                </EqCta>
                            </div>
                        </fieldset>
                    ) : (
                        <>
                            <EqCta type="submit" disabled={saving}>Guardar presupuesto</EqCta>
                            {onDelete && (
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setConfirmDelete(true)}
                                    className="h-11 text-[15px] font-semibold text-[color:var(--negative)] disabled:opacity-40"
                                >
                                    Eliminar presupuesto
                                </button>
                            )}
                        </>
                    )}
                </form>
            </div>
        </dialog>
    );
}
