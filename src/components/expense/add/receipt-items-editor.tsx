"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReceiptItem } from "@/types";
import { formatEuros, formatAmountInput, parseAmountInput } from "@/lib/currency";

// ReceiptItem with a stable client-side id used as the React key for editable rows.
// quantityStr/priceStr hold the raw text being typed so es-ES users can enter a
// comma decimal (e.g. "2,5") without it collapsing on every keystroke.
export type EditableReceiptItem = ReceiptItem & { _uid: string; quantityStr?: string; priceStr?: string };

let uidCounter = 0;
export const withUid = (item: ReceiptItem): EditableReceiptItem => ({ ...item, _uid: `item-${++uidCounter}` });

/**
 * Editable receipt line items ("Desglose de ticket"). For a 2-member space each
 * line can be assigned ½ / Yo / {partner}; those assignments override the split
 * (ITEMIZED). The parent owns the array and re-syncs the total.
 */
export function ReceiptItemsEditor({
    items,
    onChange,
    userId,
    partner,
    assignable,
}: {
    items: EditableReceiptItem[];
    onChange: (items: EditableReceiptItem[]) => void;
    userId: string;
    partner: { id: string; name: string } | null;
    assignable: boolean;
}) {
    const partnerName = partner?.name ?? "otra persona";

    const update = (index: number, patch: Partial<EditableReceiptItem>) => {
        const next = [...items];
        next[index] = { ...next[index], ...patch };
        onChange(next);
    };

    const updateNumeric = (index: number, field: "quantity" | "price", raw: string) => {
        const sanitized = raw.replace(/[^0-9.,]/g, "");
        const item = { ...items[index] };
        if (field === "quantity") {
            item.quantityStr = sanitized;
            item.quantity = Math.max(0, parseAmountInput(sanitized));
        } else {
            item.priceStr = sanitized;
            item.price = Math.max(0, parseAmountInput(sanitized));
        }
        item.total = Number((item.quantity * item.price).toFixed(2));
        const next = [...items];
        next[index] = item;
        onChange(next);
    };

    const add = () => onChange([...items, withUid({ description: "", quantity: 1, price: 0, total: 0, assignedTo: null })]);
    const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

    const myAmount = items.reduce((acc, it) => acc + (it.assignedTo === null ? it.total / 2 : it.assignedTo === userId ? it.total : 0), 0);
    const partnerAmount = items.reduce((acc, it) => acc + (it.assignedTo === null ? it.total / 2 : it.assignedTo === partner?.id ? it.total : 0), 0);

    const seg = (on: boolean) =>
        cn("px-2.5 py-2 transition-colors", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary");

    return (
        <div className="space-y-2.5">
            {items.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">Escanea un ticket o añade productos para repartir por persona.</p>
            ) : (
                <div className="rounded-[14px] border border-[color:var(--line)] bg-card divide-y divide-[color:var(--line-2)] overflow-hidden">
                    {items.map((item, idx) => (
                        <div key={item._uid} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 items-center">
                            <input
                                aria-label={`Descripción del producto ${idx + 1}`}
                                className="bg-transparent text-sm w-full focus:outline-none font-medium min-w-0 px-1"
                                value={item.description}
                                onChange={(e) => update(idx, { description: e.target.value })}
                                placeholder="Producto…"
                            />
                            <div className="flex items-center gap-1">
                                <input
                                    aria-label={`Cantidad del producto ${idx + 1}`}
                                    type="text" inputMode="decimal"
                                    className="bg-transparent text-xs w-7 text-right focus:outline-none text-muted-foreground"
                                    value={item.quantityStr ?? formatAmountInput(item.quantity)}
                                    onChange={(e) => updateNumeric(idx, "quantity", e.target.value)}
                                />
                                <span className="text-xs text-muted-foreground">×</span>
                                <input
                                    aria-label={`Precio del producto ${idx + 1}`}
                                    type="text" inputMode="decimal"
                                    className="bg-transparent text-xs w-11 text-right focus:outline-none text-muted-foreground"
                                    value={item.priceStr ?? formatAmountInput(item.price)}
                                    onChange={(e) => updateNumeric(idx, "price", e.target.value)}
                                    placeholder="0,00"
                                />
                            </div>
                            <div className="font-mono text-xs font-medium w-14 text-right tabular-nums">{item.total.toFixed(2)}</div>
                            {assignable ? (
                                <div className="flex items-center rounded-lg overflow-hidden border border-[color:var(--line)] text-[11px] font-bold">
                                    <button type="button" onClick={() => update(idx, { assignedTo: null })} aria-pressed={item.assignedTo === null} aria-label="Compartido 50/50" className={seg(item.assignedTo === null)}>½</button>
                                    <button type="button" onClick={() => update(idx, { assignedTo: userId })} aria-pressed={item.assignedTo === userId} aria-label="Solo mío" className={cn(seg(item.assignedTo === userId), "border-l border-[color:var(--line)]")}>Yo</button>
                                    <button type="button" onClick={() => update(idx, { assignedTo: partner?.id ?? null })} aria-pressed={!!partner && item.assignedTo === partner.id} aria-label={`Solo ${partnerName}`} className={cn(seg(!!partner && item.assignedTo === partner.id), "border-l border-[color:var(--line)]")}>
                                        {partner?.name?.charAt(0).toUpperCase() ?? "P"}
                                    </button>
                                </div>
                            ) : <span />}
                            <button type="button" onClick={() => remove(idx)} aria-label={`Eliminar producto ${idx + 1}`} className="p-2 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {items.length > 0 && assignable && (
                <div className="text-xs px-3 py-2 bg-[var(--track)] rounded-[10px] space-y-1">
                    <div className="flex justify-between font-semibold text-primary"><span>Tu parte</span><span className="tabular-nums">{formatEuros(myAmount)}</span></div>
                    <div className="flex justify-between font-semibold text-muted-foreground"><span>{partnerName}</span><span className="tabular-nums">{formatEuros(partnerAmount)}</span></div>
                </div>
            )}
            <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                <Plus className="h-4 w-4" /> Añadir producto
            </button>
        </div>
    );
}
