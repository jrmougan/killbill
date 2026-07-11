"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AISLES, getAisle } from "@/lib/aisles";

export interface ShoppingItem {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    note: string | null;
    aisle: string | null;
    checked: boolean;
}

export interface ItemPatch {
    name?: string;
    quantity?: number | null;
    unit?: string | null;
    note?: string | null;
    aisle?: string | null;
}

interface ShoppingItemRowProps {
    item: ShoppingItem;
    busy: boolean;
    onToggle: (checked: boolean) => void;
    onSave: (patch: ItemPatch) => Promise<boolean>;
    onDelete: () => void;
}

/** A single list row: idempotent checkbox toggle, aisle badge, meta, inline edit + delete. */
export function ShoppingItemRow({ item, busy, onToggle, onSave, onDelete }: ShoppingItemRowProps) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(item.name);
    const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : "");
    const [unit, setUnit] = useState(item.unit ?? "");
    const [note, setNote] = useState(item.note ?? "");
    const [aisle, setAisle] = useState(item.aisle ?? "");
    const [saving, setSaving] = useState(false);

    const aisleMeta = getAisle(item.aisle);
    const meta: string[] = [];
    if (item.quantity != null) meta.push(`${item.quantity}${item.unit ? ` ${item.unit}` : ""}`);
    else if (item.unit) meta.push(item.unit);

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        const trimmedQty = quantity.trim();
        const patch: ItemPatch = {
            name: name.trim(),
            quantity: trimmedQty === "" ? null : Math.trunc(Number(trimmedQty.replace(",", "."))),
            unit: unit.trim() === "" ? null : unit.trim(),
            note: note.trim() === "" ? null : note.trim(),
            aisle: aisle === "" ? null : aisle,
        };
        const ok = await onSave(patch);
        setSaving(false);
        if (ok) setEditing(false);
    };

    if (editing) {
        return (
            <div className="rounded-xl border border-[color:var(--line-strong)] bg-card p-3 space-y-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
                <div className="flex gap-2">
                    <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Cantidad" inputMode="numeric" />
                    <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unidad (ud/kg…)" />
                </div>
                <select
                    value={aisle}
                    onChange={(e) => setAisle(e.target.value)}
                    aria-label="Pasillo"
                    className="w-full h-10 rounded-md border border-[color:var(--line-strong)] bg-background px-3 text-sm text-foreground"
                >
                    <option value="">Sin pasillo</option>
                    {AISLES.map((a) => (
                        <option key={a.key} value={a.key}>
                            {a.emoji} {a.label}
                        </option>
                    ))}
                </select>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" />
                <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="gap-1">
                        <X className="h-4 w-4" /> Cancelar
                    </Button>
                    <Button size="sm" onClick={handleSave} isLoading={saving} disabled={!name.trim()} className="gap-1">
                        <Check className="h-4 w-4" /> Guardar
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-card px-3 py-2.5">
            <button
                type="button"
                onClick={() => onToggle(!item.checked)}
                disabled={busy}
                aria-pressed={item.checked}
                aria-label={item.checked ? "Marcar como pendiente" : "Marcar como comprado"}
                className={cn(
                    "h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors disabled:opacity-50",
                    item.checked ? "bg-primary border-primary text-white" : "border-[color:var(--line-strong)]",
                )}
            >
                {item.checked && <Check className="h-3.5 w-3.5" />}
            </button>

            <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium truncate", item.checked ? "line-through text-muted-foreground" : "text-foreground")}>
                    {aisleMeta && <span className="mr-1.5" title={aisleMeta.label} aria-label={aisleMeta.label}>{aisleMeta.emoji}</span>}
                    {item.name}
                </p>
                {(meta.length > 0 || item.note) && (
                    <p className="text-[11px] text-muted-foreground truncate">
                        {meta.join(" · ")}
                        {item.note && (meta.length > 0 ? ` — ${item.note}` : item.note)}
                    </p>
                )}
            </div>

            <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Editar artículo"
            >
                <Pencil className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-50"
                aria-label="Eliminar artículo"
            >
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    );
}
