"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseAmountInput, toCents } from "@/lib/currency";

interface AddItemInputProps {
    busy: boolean;
    /** Returns true on success (so the inputs clear). Item is born WITHOUT a category. */
    onAdd: (input: { name: string; priceCents: number | null }) => Promise<boolean>;
}

/** Fast capture: type "leche", Enter. Optional price alongside; no category at capture. */
export function AddItemInput({ busy, onAdd }: AddItemInputProps) {
    const [name, setName] = useState("");
    const [price, setPrice] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        const trimmed = name.trim();
        if (submitting || busy || !trimmed) return;
        setSubmitting(true);
        const trimmedPrice = price.trim();
        const priceCents = trimmedPrice === "" ? null : toCents(parseAmountInput(trimmedPrice));
        const ok = await onAdd({ name: trimmed, priceCents });
        setSubmitting(false);
        if (ok) {
            setName("");
            setPrice("");
        }
    };

    return (
        <div className="flex gap-2">
            <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Añadir artículo…"
                onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                }}
                className="flex-1"
            />
            <Input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="€"
                inputMode="decimal"
                onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                }}
                className="w-20 shrink-0"
            />
            <Button onClick={submit} isLoading={submitting} disabled={!name.trim()} className="shrink-0 gap-1.5">
                <Plus className="h-4 w-4" />
            </Button>
        </div>
    );
}
