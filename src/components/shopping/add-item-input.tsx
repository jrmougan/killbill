"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AddItemInputProps {
    busy: boolean;
    /** Returns true on success (so the input clears). The aisle is auto-assigned server-side. */
    onAdd: (input: { name: string }) => Promise<boolean>;
}

/** Fast capture: type "leche", Enter. No price, no category — nothing slows the add. */
export function AddItemInput({ busy, onAdd }: AddItemInputProps) {
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        const trimmed = name.trim();
        if (submitting || busy || !trimmed) return;
        setSubmitting(true);
        const ok = await onAdd({ name: trimmed });
        setSubmitting(false);
        if (ok) setName("");
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
            <Button onClick={submit} isLoading={submitting} disabled={!name.trim()} className="shrink-0 gap-1.5">
                <Plus className="h-4 w-4" />
            </Button>
        </div>
    );
}
