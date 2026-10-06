"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

interface AddItemInputProps {
    disabled?: boolean;
    /** Returns true on success (so the input clears). The aisle is auto-assigned server-side. */
    onAdd: (input: { name: string }) => Promise<boolean>;
}

/** Fast capture: type "leche", Enter. No price, no category — nothing slows the add. */
export function AddItemInput({ disabled, onAdd }: AddItemInputProps) {
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        const trimmed = name.trim();
        if (submitting || disabled || !trimmed) return;
        setSubmitting(true);
        const ok = await onAdd({ name: trimmed });
        setSubmitting(false);
        if (ok) setName("");
    };

    return (
        <div className="h-12 flex-none rounded-[14px] bg-card border border-[color:var(--line)] flex items-center gap-2.5 pl-3.5 pr-1.5 focus-within:border-[color:var(--accent-border)]">
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                }}
                placeholder="Añadir producto…"
                aria-label="Añadir producto"
                disabled={disabled}
                enterKeyHint="done"
                className="flex-1 min-w-0 bg-transparent text-[15px] outline-none"
            />
            <button
                type="button"
                onClick={submit}
                disabled={disabled || submitting}
                aria-label="Añadir"
                className="h-9 w-9 flex-none rounded-[10px] bg-primary text-primary-foreground flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50"
            >
                {submitting ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Plus className="h-[18px] w-[18px]" />}
            </button>
        </div>
    );
}
