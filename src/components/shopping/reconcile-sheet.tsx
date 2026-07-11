"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReconcileMatch {
    itemId: string;
    name: string;
    matchedText: string;
    confidence: number;
}

interface ReconcileSheetProps {
    matches: ReconcileMatch[];
    onCancel: () => void;
    /** Called with the item ids the user CONFIRMED to mark as bought. */
    onConfirm: (ids: string[]) => void;
}

/**
 * Confirmable suggestion sheet for OCR→list reconciliation (plan §6: never a
 * silent auto-mark). Shows the receipt matches pre-selected; the user unticks any
 * false positive and confirms — only then are the items marked bought.
 */
export function ReconcileSheet({ matches, onCancel, onConfirm }: ReconcileSheetProps) {
    // Pre-select every suggested match (high-recall; user removes false positives).
    const [selected, setSelected] = useState<Set<string>>(() => new Set(matches.map((m) => m.itemId)));

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden />
            <div className="relative w-full max-w-md bg-background rounded-t-2xl border-t border-x border-[color:var(--line)] p-4 space-y-4 max-h-[85vh] overflow-y-auto pb-8">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-foreground">Coincidencias del ticket</h2>
                    <button type="button" onClick={onCancel} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {matches.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No se encontraron artículos de la lista en el ticket. Revisa la foto o marca a mano.
                    </p>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">
                            Marca los que quieras dar por comprados. Nada se marca sin tu confirmación.
                        </p>
                        <div className="space-y-2">
                            {matches.map((m) => {
                                const on = selected.has(m.itemId);
                                return (
                                    <button
                                        key={m.itemId}
                                        type="button"
                                        onClick={() => toggle(m.itemId)}
                                        aria-pressed={on}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                                            on ? "border-primary bg-primary/5" : "border-[color:var(--line)] bg-card",
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
                                                on ? "bg-primary border-primary text-white" : "border-[color:var(--line-strong)]",
                                            )}
                                        >
                                            {on && <Check className="h-3 w-3" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-medium text-foreground truncate">{m.name}</span>
                                            {m.matchedText && (
                                                <span className="block text-[11px] text-muted-foreground truncate">
                                                    ticket: {m.matchedText}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <Button className="w-full" onClick={() => onConfirm([...selected])} disabled={selected.size === 0}>
                            Marcar {selected.size} como comprado{selected.size === 1 ? "" : "s"}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
