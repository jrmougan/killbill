"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    type CategoryContext,
    type CategoryListItem,
} from "@/lib/category-context";
import { useCategoryList } from "./use-category-list";
import type { CategoryBadgeMeta } from "./category-badge";

interface CategoryPickerProps {
    context: CategoryContext;
    /** Selected category key. */
    value: string;
    onChange: (key: string) => void;
    /** SSR-seeded list to avoid a first-paint flash. */
    initial?: CategoryListItem[];
    /**
     * Force the CURRENT category into the grid even if it isn't in the editable
     * set (e.g. editing an expense whose custom category was later deleted, or a
     * key not visible in this context) — so the selection is never silently lost.
     */
    forcedCurrent?: CategoryBadgeMeta | null;
    /** Notified whenever the effective list (re)loads — lets a parent know the valid keys. */
    onLoaded?: (categories: CategoryListItem[]) => void;
    /** Link to the management view (default `/categories`). */
    manageHref?: string;
    disabled?: boolean;
}

/**
 * Cross-cutting category selector (Fase 4). Loads the MERGE for its context
 * (shared → `/api/spaces/[id]/categories`, personal → `/api/me/categories`) and
 * renders a DB-driven grid — replacing the static category grids in
 * `expenses/new` and `expense/[id]/edit`. Color inline via `hex`, emoji as text.
 */
export function CategoryPicker({
    context,
    value,
    onChange,
    initial,
    forcedCurrent,
    onLoaded,
    manageHref = "/categories",
    disabled = false,
}: CategoryPickerProps) {
    const { categories, loading, error, reload } = useCategoryList(context, initial);

    // Notify the parent of the effective set (for OCR/validation) on every load.
    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    useEffect(() => {
        if (categories.length > 0) onLoadedRef.current?.(categories);
    }, [categories]);

    // Merge in the forced-current category when it isn't already present.
    const items = useMemo(() => {
        if (!forcedCurrent?.key) return categories;
        if (categories.some((c) => c.key === forcedCurrent.key)) return categories;
        const injected: CategoryListItem = {
            id: `forced-${forcedCurrent.key}`,
            key: forcedCurrent.key,
            label: forcedCurrent.label,
            labelEn: forcedCurrent.label,
            emoji: forcedCurrent.emoji,
            iconName: forcedCurrent.iconName ?? "Receipt",
            hex: forcedCurrent.hex,
            isSystem: false,
            sortOrder: -1,
            editable: false,
        };
        return [injected, ...categories];
    }, [categories, forcedCurrent]);

    if (loading && items.length === 0) {
        return (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando categorías…
            </div>
        );
    }

    if (error && items.length === 0) {
        return (
            <div className="rounded-xl border border-[color:var(--line)] bg-card p-4 text-center text-sm text-muted-foreground space-y-2">
                <p>{error}</p>
                <button type="button" onClick={reload} className="text-primary font-semibold hover:underline">
                    Reintentar
                </button>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-[color:var(--line-strong)] bg-card p-6 text-center text-sm text-muted-foreground space-y-2">
                <p className="font-semibold text-foreground">Sin categorías</p>
                <Link href={manageHref} className="inline-flex items-center gap-1.5 text-primary font-semibold hover:underline">
                    <Settings2 className="h-3.5 w-3.5" /> Gestionar categorías
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            <div className="grid grid-cols-4 gap-2">
                {items.map((cat) => {
                    const selected = value === cat.key;
                    return (
                        <button
                            key={cat.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(cat.key)}
                            aria-pressed={selected}
                            className={cn(
                                "flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-all active:scale-95",
                                selected
                                    ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]"
                                    : "bg-card border-[color:var(--line)] hover:bg-secondary",
                                disabled && "opacity-50 cursor-not-allowed",
                            )}
                        >
                            <span className="text-xl leading-none">{cat.emoji}</span>
                            <span className="text-[10px] font-medium text-muted-foreground text-center leading-tight px-0.5 truncate max-w-full">
                                {cat.label}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="flex justify-end">
                <Link
                    href={manageHref}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                >
                    <Settings2 className="h-3 w-3" /> Gestionar categorías
                </Link>
            </div>
        </div>
    );
}
