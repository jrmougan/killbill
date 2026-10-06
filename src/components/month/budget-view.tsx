"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { EqCard, EqChip, EqLabel, EqToast, useEqToast } from "@/components/ui/eq";
import { formatCurrency, formatAmountInput, parseEuroInput, toEuros } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { BudgetSheet } from "./budget-sheet";
import { CategoryGlyph } from "./category-glyph";
import { budgetPercent, budgetState, MAX_BUDGET_CENTS, type BudgetState } from "./aggregate";
import { formatAmountShort, type MonthScope } from "./format";
import type { BudgetEntry, MonthCategory } from "./types";

/** Amber for the ≥ 80 % warning (text ≥ 4.5:1 on white; the bar is decorative). */
const WARN_TEXT = "#8F5B00";
const WARN_BAR = "#C98A2B";

const NOT_WRITABLE =
    "Este espacio está archivado o en liquidación: los presupuestos son de solo lectura.";

/** Map an API failure to an actionable Spanish message. */
async function responseError(res: Response, action: string): Promise<Error> {
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.code === "SPACE_NOT_WRITABLE") return new Error(NOT_WRITABLE);
    const detail = typeof body?.error === "string" ? `: ${body.error}` : "";
    // A 4xx is about the request itself — retrying the same thing will not help.
    if (res.status >= 400 && res.status < 500) return new Error(`${action}${detail}.`);
    return new Error(`${action}${detail}. Vuelve a intentarlo.`);
}

/** Network failures surface as TypeError from fetch; give an actionable fallback. */
function messageOf(err: unknown, offline: string): string {
    return err instanceof Error && !(err instanceof TypeError) ? err.message : offline;
}

/**
 * Validate the typed budget (es-ES: "12,5", "1.234,56") → cents, or an error
 * message. Never coerces: anything ambiguous is rejected.
 */
export function validateBudgetInput(value: string): { cents: number } | { error: string } {
    // "0.001" would read as es-ES thousands (= 1 €); a grouped amount never starts with 0.
    const cents = /^\s*0[.,]\d{3}/.test(value) ? null : parseEuroInput(value);
    if (cents === null || cents <= 0) return { error: "Introduce un importe válido de al menos 0,01 €" };
    if (cents > MAX_BUDGET_CENTS) return { error: "El presupuesto máximo es de 1.000.000 €" };
    return { cents };
}

const STATE_LABEL: Record<BudgetState, string> = { ok: "", warn: "cerca del límite", over: "pasado" };

type SheetState = { category: MonthCategory; entry?: BudgetEntry } | null;

export function BudgetView({
    scope,
    groupId = null,
    readOnly = false,
    daysLeft,
    categories,
    initialBudgets,
    spentByCategory = {},
}: {
    scope: MonthScope;
    groupId?: string | null;
    /** SETTLING/ARCHIVED space: show the budgets without add/edit/delete. */
    readOnly?: boolean;
    daysLeft: number;
    categories: MonthCategory[];
    initialBudgets: BudgetEntry[];
    spentByCategory?: Record<string, number>;
}) {
    const router = useRouter();
    const [budgets, setBudgets] = useState<BudgetEntry[]>(initialBudgets);
    const [sheet, setSheet] = useState<SheetState>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, showToast] = useEqToast();

    // A server re-render (router.refresh after a write) is the source of truth.
    useEffect(() => {
        setBudgets(initialBudgets);
    }, [initialBudgets]);

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
    // The aggregate "Te quedan" can hide a category that is already over.
    const overRows = rows.filter((b) => budgetState(b.spent, b.amount) === "over");
    const overNames = overRows.map((b) => metaOf(b.category).label);
    const overNote = !over && overNames.length > 0
        ? `Te has pasado en ${overNames.length <= 2 ? overNames.join(" y ") : `${overNames.slice(0, 2).join(", ")} y ${overNames.length - 2} más`}`
        : null;

    const open = (category: MonthCategory, entry?: BudgetEntry) => {
        if (readOnly) return;
        setError(null);
        setSheet({ category, entry });
    };
    const close = () => {
        setSheet(null);
        setError(null);
    };

    const save = async (value: string) => {
        if (!sheet) return;
        const parsed = validateBudgetInput(value);
        if ("error" in parsed) {
            setError(parsed.error);
            return;
        }
        const { cents } = parsed;
        setError(null);
        setSaving(true);
        try {
            const res = await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    category: sheet.category.key,
                    amount: cents / 100,
                    scope,
                    ...(scope === "shared" && groupId ? { groupId } : {}),
                }),
            });
            if (!res.ok) throw await responseError(res, "No se pudo guardar el presupuesto");
            const json = await res.json().catch(() => null);
            const key = sheet.category.key;
            const id: string = typeof json?.budget?.id === "string" ? json.budget.id : sheet.entry?.id ?? `new-${key}`;
            setBudgets((prev) => {
                const rest = prev.filter((b) => b.category !== key);
                const spentNow = prev.find((b) => b.category === key)?.spent ?? spentByCategory[key] ?? 0;
                return [...rest, { id, category: key, amount: cents, spent: spentNow }];
            });
            showToast(`Presupuesto de ${sheet.category.label}: ${formatCurrency(cents)}`);
            close();
            router.refresh();
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
            if (scope === "shared" && groupId) qs.set("groupId", groupId);
            const res = await fetch(`/api/budget?${qs}`, { method: "DELETE" });
            if (!res.ok) throw await responseError(res, "No se pudo eliminar el presupuesto");
            const key = sheet.entry.category;
            setBudgets((prev) => prev.filter((b) => b.category !== key));
            showToast(`Presupuesto de ${sheet.category.label} eliminado`);
            close();
            router.refresh();
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
                                style={{
                                    width: `${pct}%`,
                                    background: over ? "var(--negative)" : overNote ? WARN_BAR : "var(--positive)",
                                }}
                            />
                        </div>
                        <span className="text-[12.5px] text-muted-foreground">
                            {formatCurrency(spent)} de {formatCurrency(total)} en categorías con presupuesto
                        </span>
                        {overNote && (
                            <span
                                data-testid="budget-over-note"
                                className="flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--negative)]"
                            >
                                <AlertTriangle className="h-3.5 w-3.5 flex-none" aria-hidden />
                                {overNote}
                            </span>
                        )}
                    </section>

                    <EqCard className="px-4 py-1">
                        <ul>
                            {rows.map((b, i) => {
                                const cat = metaOf(b.category);
                                const state = budgetState(b.spent, b.amount);
                                const percent = budgetPercent(b.spent, b.amount);
                                const w = b.amount > 0 ? Math.min(100, (b.spent / b.amount) * 100) : 0;
                                const stateText = STATE_LABEL[state];
                                const inner = (
                                    <>
                                        <span className="flex w-full items-center justify-between gap-3 text-sm">
                                            <span className="flex items-center gap-1.5 font-semibold min-w-0">
                                                <CategoryGlyph category={cat} />
                                                <span className="truncate">{cat.label}</span>
                                            </span>
                                            <span
                                                className={cn(
                                                    "flex-none tabular-nums",
                                                    state === "over" ? "text-[color:var(--negative)] font-semibold" : "text-muted-foreground",
                                                )}
                                            >
                                                {formatAmountShort(b.spent)} / {formatAmountShort(b.amount)} €
                                            </span>
                                        </span>
                                        <span className="flex w-full items-center gap-2.5">
                                            <span className="block h-[5px] flex-1 rounded-[3px] bg-[var(--surface-raised-hex)] overflow-hidden">
                                                <span
                                                    className="block h-full rounded-[3px]"
                                                    style={{
                                                        width: `${w}%`,
                                                        background: state === "over"
                                                            ? "var(--negative)"
                                                            : state === "warn"
                                                                ? WARN_BAR
                                                                : cat.hex || "var(--positive)",
                                                    }}
                                                />
                                            </span>
                                            <span
                                                data-testid="budget-percent"
                                                className={cn(
                                                    "flex-none text-[12px] font-semibold tabular-nums",
                                                    state === "over" ? "text-[color:var(--negative)]" : state === "ok" && "text-muted-foreground",
                                                )}
                                                style={state === "warn" ? { color: WARN_TEXT } : undefined}
                                            >
                                                {percent}%{stateText && <span className="font-medium"> · {stateText}</span>}
                                            </span>
                                        </span>
                                    </>
                                );
                                return (
                                    <li key={b.id} className={cn(i < rows.length - 1 && "border-b border-[color:var(--line-2)]")}>
                                        {readOnly ? (
                                            <div className="w-full py-3 flex flex-col gap-2">{inner}</div>
                                        ) : (
                                            <button
                                                type="button"
                                                aria-label={`Editar presupuesto de ${cat.label}`}
                                                onClick={() => open(cat, b)}
                                                className="w-full py-3 flex flex-col gap-2 text-left"
                                            >
                                                {inner}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </EqCard>
                </>
            ) : (
                <p className="py-4 text-[15px] leading-[1.45] text-muted-foreground">
                    {readOnly
                        ? "Este espacio no tiene presupuestos este mes."
                        : "Aún no tienes presupuestos aquí. Elige una categoría para ponerle un límite mensual."}
                </p>
            )}

            {!readOnly && unbudgeted.length > 0 && (
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

            {sheet && !readOnly && (
                <BudgetSheet
                    key={sheet.entry?.id ?? sheet.category.key}
                    category={sheet.category}
                    initialValue={sheet.entry ? formatAmountInput(toEuros(sheet.entry.amount)) : ""}
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
