"use client";

import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { EqCard, EqChip, EqLabel } from "@/components/ui/eq";
import type { CategoryBadgeMeta } from "@/components/category/category-badge";

export type DateRange = "all" | "week" | "month" | "year";
export type AdvancedFilters = { categories: string[]; dateRange: DateRange };

export const EMPTY_FILTERS: AdvancedFilters = { categories: [], dateRange: "all" };

const RANGES: { value: DateRange; label: string }[] = [
    { value: "all", label: "Siempre" },
    { value: "week", label: "7 días" },
    { value: "month", label: "Este mes" },
    { value: "year", label: "Este año" },
];

export function activeFilterCount(f: AdvancedFilters): number {
    return f.categories.length + (f.dateRange !== "all" ? 1 : 0);
}

/** Small "Filtros" toggle (sits next to the payer chips). */
export function FiltersToggle({
    open,
    count,
    onToggle,
}: {
    open: boolean;
    count: number;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls="expense-filters-panel"
            className={cn(
                "ml-auto flex-none inline-flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[13px] font-semibold transition-colors",
                open || count > 0 ? "border-foreground bg-card" : "border-[color:var(--line)] bg-card text-muted-foreground",
            )}
        >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros{count > 0 && <span className="tabular-nums">· {count}</span>}
        </button>
    );
}

/**
 * Advanced filters for Gastos (category + date range), tucked behind
 * "Filtros" so the default view matches the prototype.
 */
export function ExpenseFiltersPanel({
    value,
    onChange,
    categories,
}: {
    value: AdvancedFilters;
    onChange: (v: AdvancedFilters) => void;
    categories: CategoryBadgeMeta[];
}) {
    const toggleCategory = (key: string) =>
        onChange({
            ...value,
            categories: value.categories.includes(key)
                ? value.categories.filter((c) => c !== key)
                : [...value.categories, key],
        });

    return (
        <EqCard id="expense-filters-panel" className="eq-in p-3.5 space-y-3">
            <div className="space-y-2">
                <EqLabel>Periodo</EqLabel>
                <div className="eq-scroll flex gap-1.5 overflow-x-auto">
                    {RANGES.map((r) => (
                        <EqChip key={r.value} selected={value.dateRange === r.value} onClick={() => onChange({ ...value, dateRange: r.value })}>
                            {r.label}
                        </EqChip>
                    ))}
                </div>
            </div>
            {categories.length > 0 && (
                <div className="space-y-2">
                    <EqLabel>Categorías</EqLabel>
                    <div className="flex flex-wrap gap-1.5">
                        {categories.map((c) => {
                            const key = c.key ?? c.label;
                            return (
                                <EqChip key={key} tone="accent" selected={value.categories.includes(key)} onClick={() => toggleCategory(key)}>
                                    {c.emoji} {c.label}
                                </EqChip>
                            );
                        })}
                    </div>
                </div>
            )}
            {activeFilterCount(value) > 0 && (
                <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-[13px] font-semibold text-primary">
                    Quitar filtros
                </button>
            )}
        </EqCard>
    );
}
