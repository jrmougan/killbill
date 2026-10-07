"use client";

import { ChevronDown, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EqChip } from "@/components/ui/eq";
import { PERSONAL_SPACE, spaceEmoji } from "@/components/expenses/space-meta";
import type { AddMember, AddSpace, BlockedSpace } from "./expense-form-state";

const STATUS_LABEL: Record<BlockedSpace["status"], string> = { SETTLING: "se está liquidando", ARCHIVED: "está archivado" };

/** Top bar: close + where the expense goes (+ the note about spaces that take no new expenses). */
export function SpaceBar({
    isEdit,
    spaces,
    spaceId,
    isPersonal,
    allowPersonal,
    blockedSpaces,
    onClose,
    onChange,
}: {
    isEdit: boolean;
    spaces: AddSpace[];
    spaceId: string;
    isPersonal: boolean;
    allowPersonal: boolean;
    blockedSpaces: BlockedSpace[];
    onClose: () => void;
    onChange: (id: string) => void;
}) {
    const spaceChips = isEdit ? spaces.filter((s) => s.id === spaceId) : spaces;
    return (
        <>
            <div className="flex items-center gap-2.5 px-5 pt-3 pb-1">
                <button type="button" onClick={onClose} aria-label="Cerrar" data-testid="expense-close" className="h-6 w-6 flex-none">
                    <X className="h-6 w-6" />
                </button>
                <h1 className={isEdit ? "flex-none text-[17px] font-bold tracking-[-0.01em]" : "sr-only"}>
                    {isEdit ? "Editar gasto" : "Nuevo gasto"}
                </h1>
                <fieldset aria-label="Espacio del gasto" className="eq-scroll m-0 min-w-0 border-0 p-0 flex-1 flex gap-1.5 overflow-x-auto">
                    {spaceChips.map((s) => (
                        <EqChip
                            key={s.id}
                            tone="accent"
                            selected={s.id === spaceId}
                            onClick={() => onChange(s.id)}
                            disabled={isEdit}
                            className="max-w-full py-1.5"
                            data-testid={`space-chip-${s.id}`}
                        >
                            <span className="block truncate">{spaceEmoji(s.type)} {s.name}</span>
                        </EqChip>
                    ))}
                    {allowPersonal && (!isEdit || isPersonal) && (
                        <EqChip tone="accent" selected={isPersonal} onClick={() => onChange(PERSONAL_SPACE)} disabled={isEdit} className="py-1.5" data-testid="space-chip-personal">
                            {spaceEmoji(null)} Personal
                        </EqChip>
                    )}
                </fieldset>
            </div>
            {!isEdit && blockedSpaces.length > 0 && (
                <p data-testid="blocked-spaces-note" className="mx-5 mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
                    <Info className="mt-px h-3.5 w-3.5 flex-none" aria-hidden />
                    <span>
                        {blockedSpaces.map((b) => `«${b.name}» ${STATUS_LABEL[b.status]}`).join(" · ")}
                        {blockedSpaces.length === 1 ? ": no admite gastos nuevos." : ": no admiten gastos nuevos."}
                    </span>
                </p>
            )}
        </>
    );
}

/** The big amount input (typed / pasted; the numpad writes into the same value). */
export function AmountField({ amount, invalid, onType }: { amount: string; invalid: boolean; onType: (raw: string) => void }) {
    return (
        <label className="flex max-w-full items-baseline justify-center text-[clamp(38px,13vw,56px)] font-bold leading-none tracking-[-0.03em] [@media(max-height:640px)]:text-[40px]">
            <span className="sr-only">Importe en euros</span>
            {/* Auto-width input: an invisible twin sizes the grid cell, and
                the input itself takes no intrinsic width so short
                amounts stay centred (G-10). */}
            <span className="inline-grid min-w-0">
                <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">{amount || "0"}</span>
                <input
                    data-testid="expense-amount"
                    inputMode="none"
                    autoComplete="off"
                    value={amount}
                    placeholder="0"
                    size={1}
                    aria-invalid={invalid}
                    onChange={(e) => onType(e.target.value)}
                    className="col-start-1 row-start-1 w-0 min-w-full bg-transparent p-0 text-right text-foreground caret-primary outline-none placeholder:text-[color:var(--ink-3)]"
                />
            </span>
            <span className="text-[color:var(--ink-3)]">&nbsp;€</span>
        </label>
    );
}

export type CategoryOption = { key: string; label: string; emoji: string };

/** Category chips of the effective set (system ∪ space/personal custom). */
export function CategoryChips({
    categories,
    loading,
    selected,
    onPick,
}: {
    categories: CategoryOption[];
    loading: boolean;
    selected: string | null;
    onPick: (key: string) => void;
}) {
    return (
        <fieldset aria-label="Categoría" className="eq-scroll m-0 min-w-0 border-0 p-0 flex w-full gap-1.5 overflow-x-auto text-[13px] font-semibold">
            {loading && categories.length === 0 && (
                <span className="py-[7px] text-muted-foreground">Cargando categorías…</span>
            )}
            {categories.map((c) => {
                const on = c.key === selected;
                return (
                    <button
                        key={c.key}
                        type="button"
                        aria-pressed={on}
                        data-testid={`category-chip-${c.key}`}
                        onClick={() => onPick(c.key)}
                        className={cn(
                            "flex-none whitespace-nowrap rounded-[10px] border px-[11px] py-[7px] transition-colors",
                            on ? "bg-[var(--accent-tint)] text-primary border-primary" : "bg-card border-[color:var(--line)]",
                        )}
                    >
                        {c.emoji} {c.label}
                    </button>
                );
            })}
        </fieldset>
    );
}

/** "Pagó" (payer select) and "Reparto" (cycles the quick splits) tiles of a shared space. */
export function PayerSplitTiles({
    members,
    userId,
    payerId,
    splitLabel,
    onPayer,
    onCycleSplit,
}: {
    members: AddMember[];
    userId: string;
    payerId: string;
    splitLabel: string;
    onPayer: (id: string) => void;
    onCycleSplit: () => void;
}) {
    const payerName = (id: string) => (id === userId ? "Tú" : members.find((m) => m.id === id)?.name ?? "Tú");
    return (
        <div className="grid w-full grid-cols-2 gap-2">
            <label className="relative block rounded-[14px] border border-[color:var(--line)] bg-card px-3 py-[9px] cursor-pointer">
                <span className="block text-[11px] text-muted-foreground">Pagó</span>
                <span className="flex items-center justify-between text-sm font-semibold">
                    <span className="truncate">{payerName(payerId)}</span>
                    <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                </span>
                <select
                    aria-label="Pagó"
                    data-testid="expense-payer"
                    value={payerId}
                    onChange={(e) => onPayer(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                    {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.id === userId ? "Tú" : m.name}</option>
                    ))}
                </select>
            </label>
            <button
                type="button"
                onClick={onCycleSplit}
                data-testid="expense-split"
                aria-label={`Reparto: ${splitLabel}. Cambiar`}
                className="rounded-[14px] border border-[color:var(--line)] bg-card px-3 py-[9px] text-left"
            >
                <span className="block text-[11px] text-muted-foreground">Reparto</span>
                <span className="flex items-center justify-between gap-1 text-sm font-semibold whitespace-nowrap">
                    <span className="truncate">{splitLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                </span>
            </button>
        </div>
    );
}
