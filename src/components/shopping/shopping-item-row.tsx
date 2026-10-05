"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

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

/** "2 kg · sin lactosa" — quantity/unit and note, or "" when there is none. */
export function itemMeta(item: Pick<ShoppingItem, "quantity" | "unit" | "note">): string {
    const parts: string[] = [];
    if (item.quantity != null) parts.push(`${item.quantity}${item.unit ? ` ${item.unit}` : ""}`);
    else if (item.unit) parts.push(item.unit);
    if (item.note) parts.push(item.note);
    return parts.join(" · ");
}

interface ShoppingItemRowProps {
    item: ShoppingItem;
    /** Pending rows carry a hairline divider except the last one. */
    divider?: boolean;
    onToggle: () => void;
    onEdit: () => void;
}

/**
 * One list row: a 22px rounded checkbox (idempotent toggle) and the item text,
 * which opens the edit sheet. Checked rows render faint and struck through.
 */
export function ShoppingItemRow({ item, divider, onToggle, onEdit }: ShoppingItemRowProps) {
    const meta = itemMeta(item);
    return (
        <div
            className={cn(
                "flex items-center",
                divider && "border-b border-[color:var(--line-2)]",
                item.checked && "text-[color:var(--ink-3)]"
            )}
        >
            <label className={cn("relative flex-none pr-3 flex items-center cursor-pointer", item.checked ? "py-[9px]" : "py-[13px]")}>
                <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={onToggle}
                    aria-label={item.name}
                    className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
                />
                <span
                    aria-hidden
                    className={cn(
                        "h-[22px] w-[22px] rounded-[7px] flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                        item.checked ? "bg-primary text-primary-foreground" : "border-2 border-[color:var(--ink-4)]"
                    )}
                >
                    {item.checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
            </label>
            <button
                type="button"
                onClick={onEdit}
                aria-label={`Editar ${item.name}`}
                className={cn("flex-1 min-w-0 text-left", item.checked ? "py-[9px]" : "py-[13px]")}
            >
                <span className={cn("block truncate text-[15px]", item.checked && "line-through")}>{item.name}</span>
                {meta && (
                    <span className={cn("block truncate text-xs", item.checked ? "text-[color:var(--ink-4)]" : "text-muted-foreground")}>
                        {meta}
                    </span>
                )}
            </button>
        </div>
    );
}
