"use client";

import { useCallback, useMemo, useState } from "react";
import { EqCard, EqChip, EqLabel, EqToast, useEqToast } from "@/components/ui/eq";
import { formatCurrency, toCents, toEuros } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { BudgetSheet } from "./budget-sheet";
import { CategoryGlyph } from "./category-glyph";
import { formatAmountShort, type MonthScope } from "./format";
import type { BudgetEntry, MonthCategory } from "./types";

async function responseError(res: Response, message: string): Promise<Error> {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.error === "string" ? `: ${body.error}` : "";
    return new Error(`${message}${detail}. Vuelve a intentarlo.`);
}

/** Network failures surface as TypeError from fetch; give an actionable fallback. */
function messageOf(err: unknown, offline: string): string {
    return err instanceof Error && !(err instanceof TypeError) ? err.message : offline;
}

type SheetState = { category: MonthCategory; entry?: BudgetEntry } | null;

export function BudgetView({
    scope,
    daysLeft,
    categories,
    initialBudgets,
}: {
    scope: MonthScope;
    daysLeft: number;
    categories: MonthCategory[];
    initialBudgets: BudgetEntry[];
}) {
    const [budgets, setBudgets] = useState<BudgetEntry[]>(initialBudgets);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, showToast] = useEqToast();

    const catByKey = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories]);
    const order = useMemo(() => new Map(categories.map((c, i) => [c.key, i])), [categories]);
    const metaOf = (key: string): MonthCategory =>
        catByKey.get(key) ?? { key, label: key, emoji: "", iconName: "", hex: "" };

    // Rows follow the effective category order (not the DB id order).
    const rows = [...budgets].sort(
        (a, b) => (order.get(a.category) ?? 999) - (order.get(b.category) ?? 999) || a.category.localeCompare(b.category),
    );
    const budgeted = new Set(budgets.map((b) => b.category));
    const unbudgeted = categories.filter((c) => !budgeted.has(c.key));

    const total = budgets.reduce((s, b) => s + b.amount, 0);
    const spent = budgets.reduce((s, b) => s + b.spent, 0);
    const remain = total - spent;
    const over = remain < 0;
    const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;

    const reload = useCallback(async () => {
        const res = await fetch(`/api/budget?scope=${scope}`);
        if (!res.ok) throw await responseError(res, "No se pudieron cargar los presupuestos");
        const json = await res.json();
        if (!Array.isArray(json.budgets)) throw new Error("Respuesta de presupuestos inválida. Vuelve a intentarlo.");
        setBudgets(json.budgets.map((e: { budget: { id: string; category: string; amount: number }; spent: number }) => ({
            id: e.budget.id,
            category: e.budget.category,
            amount: e.budget.amount,
            spent: e.spent,
        })));
    }, [scope]);

    const open = (category: MonthCategory, entry?: BudgetEntry) => {
        setError(null);
        setSheet({ category, entry });
    };
    const close = () => {
        setSheet(null);
        setError(null);
    };

    const save = async (value: string) => {
        if (!sheet) return;
        const amount = Number(value.replace(",", "."));
        const cents = toCents(amount);
        if (!value.trim() || !Number.isFinite(amount) || !Number.isFinite(cents) || cents <= 0) {
            setError("Introduce un importe válido de al menos 0,01 €");
            return;
        }
        setError(null);
        setSaving(true);
        try {
            const res = await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: sheet.category.key, amount, scope }),
            });
            if (!res.ok) throw await responseError(res, "No se pudo guardar el presupuesto");
            await reload();
            showToast(`Presupuesto de ${sheet.category.label}: ${formatCurrency(cents)}`);
            close();
        } catch (err) {
            setError(messageOf(err, "No se pudo guardar o actualizar el presupuesto. Comprueba tu conexión y vuelve a intentarlo."));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!sheet?.entry) return;
        setError(null);
        setSaving(true);
        try {
            const qs = new URLSearchParams({ id: sheet.entry.id, scope });
            const res = await fetch(`/api/budget?${qs}`, { method: "DELETE" });
            if (!res.ok) throw await responseError(res, "No se pudo eliminar el presupuesto");
            await reload();
            showToast(`Presupuesto de ${sheet.category.label} eliminado`);
            close();
        } catch (err) {
            setError(messageOf(err, "No se pudo eliminar el presupuesto. Comprueba tu conexión y vuelve a intentarlo."));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {rows.length > 0 ? (
                <>
                    <section aria-label="Resumen del mes" className="flex flex-col gap-1.5">
                        <span className="text-sm text-muted-foreground">
                            {over ? "Te has pasado" : `Te quedan para ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`}
                        </span>
                        <span
                            data-testid="budget-remaining"
                            className={cn(
                                "text-[44px] font-bold tracking-[-0.03em] leading-none tabular-nums",
                                over && "text-[color:var(--negative)]",
                            )}
                        >
                            {formatCurrency(Math.abs(remain))}
                        </span>
                        {/* Decorative: the summary line below states the same figures. */}
                        <div
                            aria-hidden
                            className="mt-2 h-2 rounded-full bg-[var(--surface-raised-hex)] overflow-hidden"
                        >
                            <div
                                className="h-full rounded-full transition-[width] duration-300"
                                style={{ width: `${pct}%`, background: over ? "var(--negative)" : "var(--positive)" }}
                            />
                        </div>
                        <span className="text-[12.5px] text-muted-foreground">
                            {formatCurrency(spent)} de {formatCurrency(total)} en categorías con presupuesto
                        </span>
                    </section>

                    <EqCard className="px-4 py-1">
                        <ul>
                            {rows.map((b, i) => {
                                const cat = metaOf(b.category);
                                const rowOver = b.spent > b.amount;
                                const w = b.amount > 0 ? Math.min(100, (b.spent / b.amount) * 100) : 0;
                                return (
                                    <li key={b.id} className={cn(i < rows.length - 1 && "border-b border-[color:var(--line-2)]")}>
                                        <button
                                            type="button"
                                            aria-label={`Editar presupuesto de ${cat.label}`}
                                            onClick={() => open(cat, b)}
                                            className="w-full py-3 flex flex-col gap-2 text-left"
                                        >
                                            <span className="flex w-full items-center justify-between gap-3 text-sm">
                                                <span className="flex items-center gap-1.5 font-semibold min-w-0">
                                                    <CategoryGlyph category={cat} />
                                                    <span className="truncate">{cat.label}</span>
                                                </span>
                                                <span
                                                    className={cn(
                                                        "flex-none tabular-nums",
                                                        rowOver ? "text-[color:var(--negative)] font-semibold" : "text-muted-foreground",
                                                    )}
                                                >
                                                    {formatAmountShort(b.spent)} / {formatAmountShort(b.amount)} €
                                                </span>
                                            </span>
                                            <span className="block h-[5px] w-full rounded-[3px] bg-[var(--surface-raised-hex)] overflow-hidden">
                                                <span
                                                    className="block h-full rounded-[3px]"
                                                    style={{ width: `${w}%`, background: rowOver ? "var(--negative)" : cat.hex || "var(--positive)" }}
                                                />
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </EqCard>
                </>
            ) : (
                <p className="py-4 text-[15px] leading-[1.45] text-muted-foreground">
                    Aún no tienes presupuestos aquí. Elige una categoría para ponerle un límite mensual.
                </p>
            )}

            {unbudgeted.length > 0 && (
                <section aria-labelledby="month-unbudgeted" className="flex flex-col gap-2">
                    <EqLabel id="month-unbudgeted">Sin presupuesto · toca para añadir</EqLabel>
                    <div className="flex flex-wrap gap-1.5">
                        {unbudgeted.map((c) => (
                            <EqChip
                                key={c.key}
                                tone="add"
                                aria-label={`Añadir presupuesto de ${c.label}`}
                                onClick={() => open(c)}
                                className="inline-flex items-center gap-1"
                            >
                                + <CategoryGlyph category={c} className="h-3.5 w-3.5" /> {c.label}
                            </EqChip>
                        ))}
                    </div>
                </section>
            )}

            {sheet && (
                <BudgetSheet
                    key={sheet.entry?.id ?? sheet.category.key}
                    category={sheet.category}
                    initialValue={sheet.entry ? String(toEuros(sheet.entry.amount)) : ""}
                    saving={saving}
                    error={error}
                    onSave={save}
                    onDelete={sheet.entry ? remove : undefined}
                    onClose={close}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </>
    );
}
