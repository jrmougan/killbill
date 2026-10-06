"use client";

import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { EqCta } from "@/components/ui/eq";
import { AISLES } from "@/lib/aisles";
import { formatQuantity, parseQuantityInput } from "@/lib/list-quantity";
import { Sheet, SheetField } from "./sheet";
import type { ItemPatch, ShoppingItem } from "./shopping-item-row";

/** Edit an item's name, quantity/unit, aisle and note — or delete it. */
export function ItemEditSheet({
    item,
    onClose,
    onSave,
    onDelete,
}: {
    item: ShoppingItem;
    onClose: () => void;
    /** Resolve to an error message, or null on success (the sheet then closes). */
    onSave: (patch: ItemPatch) => Promise<string | null>;
    onDelete: () => Promise<string | null>;
}) {
    const [name, setName] = useState(item.name);
    const [quantity, setQuantity] = useState(item.quantity != null ? formatQuantity(item.quantity) : "");
    const [unit, setUnit] = useState(item.unit ?? "");
    const [note, setNote] = useState(item.note ?? "");
    const [aisle, setAisle] = useState(item.aisle ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [qtyError, setQtyError] = useState<string | null>(null);
    const aisleId = useId();
    const qtyErrorId = useId();

    const save = async () => {
        if (busy || !name.trim()) return;
        // Never truncate or silently clear: a bad quantity keeps the sheet open.
        const qty = parseQuantityInput(quantity);
        if (!qty.ok) {
            setQtyError(qty.error);
            return;
        }
        setQtyError(null);
        setBusy(true);
        setError(null);
        const err = await onSave({
            name: name.trim(),
            quantity: qty.value,
            unit: unit.trim() === "" ? null : unit.trim(),
            note: note.trim() === "" ? null : note.trim(),
            aisle: aisle === "" ? null : aisle,
        });
        setBusy(false);
        if (err) setError(err);
        else onClose();
    };

    const remove = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        const err = await onDelete();
        setBusy(false);
        if (err) setError(err);
        else onClose();
    };

    return (
        <Sheet title="Editar producto" onClose={onClose}>
            <div className="flex flex-col gap-3">
                <SheetField label="Nombre" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                <div className="grid grid-cols-2 gap-2.5">
                    <SheetField
                        label="Cantidad"
                        value={quantity}
                        onChange={(e) => {
                            setQuantity(e.target.value);
                            setQtyError(null);
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        aria-invalid={qtyError ? true : undefined}
                        aria-describedby={qtyError ? qtyErrorId : undefined}
                    />
                    <SheetField label="Unidad" maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ud, kg, pack…" />
                </div>
                {qtyError && (
                    <p id={qtyErrorId} role="alert" className="-mt-1 pl-1 text-sm text-destructive">
                        {qtyError}
                    </p>
                )}
                <div className="flex flex-col gap-1.5">
                    <label htmlFor={aisleId} className="text-xs font-semibold text-muted-foreground pl-1">
                        Pasillo
                    </label>
                    <select
                        id={aisleId}
                        value={aisle}
                        onChange={(e) => setAisle(e.target.value)}
                        className="h-12 rounded-[14px] border border-[color:var(--line)] bg-card px-3 text-[15px] outline-none"
                    >
                        <option value="">Sin pasillo</option>
                        {AISLES.map((a) => (
                            <option key={a.key} value={a.key}>
                                {a.emoji} {a.label}
                            </option>
                        ))}
                    </select>
                </div>
                <SheetField label="Nota" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <EqCta className="mt-2" onClick={save} disabled={busy || !name.trim()}>
                    Guardar
                </EqCta>
                <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="h-11 flex items-center justify-center gap-2 text-[15px] font-semibold text-destructive disabled:opacity-50"
                >
                    <Trash2 className="h-4 w-4" /> Eliminar producto
                </button>
            </div>
        </Sheet>
    );
}
