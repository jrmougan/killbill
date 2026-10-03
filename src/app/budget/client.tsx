"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Check, X } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEuros, toEuros, toCents } from "@/lib/currency";
import { getIconComponent } from "@/lib/category-icons";
import { hexWithAlpha } from "@/lib/category-colors";
import { type CategoryContext, type CategoryListItem } from "@/lib/category-context";
import { useCategoryList } from "@/components/category/use-category-list";

interface BudgetEntry {
    budget: {
        id: string;
        category: string;
        amount: number;
        month: string;
    };
    spent: number;
    percentage: number;
}

type BudgetScope = "shared" | "personal";

interface BudgetClientProps {
    budgetData: BudgetEntry[];
    monthLabel: string;
    hasCouple?: boolean;
    /** The active group id (for the shared-scope categories endpoint). */
    groupId?: string | null;
    /** Effective category set for the default scope, seeded from the server. */
    initialCategories?: CategoryListItem[];
}

async function responseError(res: Response, message: string): Promise<Error> {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.error === "string" ? `: ${body.error}` : "";
    return new Error(`${message}${detail}. Vuelve a intentarlo.`);
}

function ProgressBar({ percentage }: { percentage: number }) {
    const clamped = Math.min(percentage, 100);
    const colorClass =
        percentage > 100
            ? "bg-[color:var(--negative)]"
            : percentage >= 80
            ? "bg-[#C9A227]"
            : "bg-[color:var(--positive)]";

    return (
        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
                className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                style={{ width: `${clamped}%` }}
            />
        </div>
    );
}

export function BudgetClient({ budgetData, monthLabel, hasCouple = true, groupId = null, initialCategories = [] }: BudgetClientProps) {
    const router = useRouter();
    const [scope, setScope] = useState<BudgetScope>(hasCouple ? "shared" : "personal");

    // Effective category list for the active scope (DB-driven). Shared → the
    // space endpoint; personal → /api/me. Seeded from the server for the default
    // scope so the first paint doesn't flash.
    const categoryContext: CategoryContext =
        scope === "shared" && groupId ? { kind: "shared", groupId } : { kind: "personal" };
    const { categories: catList } = useCategoryList(categoryContext, initialCategories);
    const catByKey = new Map(catList.map((c) => [c.key, c]));
    const [data, setData] = useState<BudgetEntry[]>(budgetData);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [addingCategory, setAddingCategory] = useState<string | null>(null);
    const [addValue, setAddValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Reload the current scope's budgets from the API (personal or shared).
    const reload = useCallback(async (s: BudgetScope) => {
        const res = await fetch(`/api/budget?scope=${s}`);
        if (!res.ok) throw await responseError(res, "No se pudieron cargar los presupuestos");
        const json = await res.json();
        if (!Array.isArray(json.budgets)) throw new Error("Respuesta de presupuestos inválida. Vuelve a intentarlo.");
        // Server props use euros; the API exposes persisted amounts in cents.
        setData(json.budgets.map((entry: BudgetEntry) => ({
            ...entry,
            budget: { ...entry.budget, amount: toEuros(entry.budget.amount) },
            spent: toEuros(entry.spent),
        })));
    }, []);

    const loadScope = useCallback(async (s: BudgetScope) => {
        setLoading(true);
        setLoadError(null);
        try {
            await reload(s);
        } catch (err) {
            setLoadError(err instanceof Error && !(err instanceof TypeError)
                ? err.message
                : "No se pudieron cargar los presupuestos. Comprueba tu conexión y vuelve a intentarlo.");
        } finally {
            setLoading(false);
        }
    }, [reload]);

    // The server pre-renders the SHARED budgets; only refetch when the scope
    // actually changes (skip the initial shared render).
    const didMount = useRef(false);
    useEffect(() => {
        if (!didMount.current) {
            didMount.current = true;
            if (scope === "shared") return; // already have server data
        }
        void loadScope(scope);
    }, [scope, loadScope]);

    const budgetedCategories = new Set(data.map((b) => b.budget.category));
    const unbudgetedCategories = catList.filter(
        (cat) => !budgetedCategories.has(cat.key)
    );

    const saveBudget = async (category: string, value: string): Promise<boolean> => {
        const amount = Number(value.replace(",", "."));
        const cents = toCents(amount);
        if (!Number.isFinite(amount) || !Number.isFinite(cents) || cents <= 0) {
            setError("Introduce un importe válido de al menos 0,01 €");
            return false;
        }
        setError(null);
        setSaving(true);
        try {
            const res = await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category, amount, scope }),
            });
            if (!res.ok) throw await responseError(res, "No se pudo guardar el presupuesto");
            await reload(scope);
            router.refresh();
            return true;
        } catch (err) {
            setError(err instanceof Error && !(err instanceof TypeError)
                ? err.message
                : "No se pudo guardar o actualizar el presupuesto. Comprueba tu conexión y vuelve a intentarlo.");
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleSaveEdit = async (entry: BudgetEntry) => {
        if (await saveBudget(entry.budget.category, editValue)) {
            setEditingId(null);
            setEditValue("");
        }
    };

    const handleAddBudget = async (categoryId: string) => {
        if (await saveBudget(categoryId, addValue)) {
            setAddingCategory(null);
            setAddValue("");
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-xl font-bold">Presupuestos</h1>
                    <p className="text-xs text-muted-foreground">{monthLabel}</p>
                </div>
            </header>

            {hasCouple && (
                <div className="flex gap-1.5 p-1 rounded-xl bg-secondary border border-[color:var(--line)]">
                    {([["shared", "Común"], ["personal", "Personal"]] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => { setScope(key); setEditingId(null); setAddingCategory(null); setError(null); }}
                            disabled={saving || loading}
                            aria-pressed={scope === key}
                            className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-all ${scope === key ? "bg-primary text-white shadow" : "text-muted-foreground"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {loading && <output className="text-sm text-muted-foreground">Cargando presupuestos…</output>}
            {loadError && (
                <GlassCard className="p-4 space-y-3">
                    <p role="alert" className="text-sm text-destructive">{loadError}</p>
                    <Button onClick={() => void loadScope(scope)} disabled={loading}>Reintentar carga</Button>
                </GlassCard>
            )}

            {!loading && !loadError && data.length === 0 && catList.length > 0 && unbudgetedCategories.length === catList.length ? (
                <GlassCard className="p-8 text-center space-y-3">
                    <div className="text-5xl">📊</div>
                    <h2 className="text-lg font-bold">Sin presupuestos aún</h2>
                    <p className="text-sm text-muted-foreground">
                        Empieza definiendo cuánto quieres gastar por categoría
                    </p>
                </GlassCard>
            ) : null}

            {!loading && !loadError && data.length > 0 && (
                <section className="space-y-3">
                    {data.map((entry) => {
                        const cat = catByKey.get(entry.budget.category);
                        const Icon = getIconComponent(cat?.iconName);
                        const isEditing = editingId === entry.budget.id;

                        return (
                            <GlassCard key={entry.budget.id} className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="h-10 w-10 rounded-xl flex items-center justify-center"
                                            style={{ backgroundColor: cat ? hexWithAlpha(cat.hex, 0.12) : "var(--secondary)" }}
                                        >
                                            <Icon className="h-5 w-5" style={{ color: cat?.hex ?? "var(--foreground)" }} />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm">{cat?.label ?? entry.budget.category}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {entry.percentage}%
                                            </p>
                                        </div>
                                    </div>

                                    {isEditing ? (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min="0.01"
                                                    step="0.01"
                                                    aria-label="Importe del presupuesto"
                                                    disabled={saving}
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="w-24 h-8 text-sm"
                                                    placeholder="0.00"
                                                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- focus the inline edit input the user just opened so they can type immediately
                                                    autoFocus
                                                />
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-[color:var(--positive)] hover:opacity-80"
                                                    aria-label="Guardar presupuesto"
                                                    onClick={() => handleSaveEdit(entry)}
                                                    disabled={saving}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    aria-label="Cancelar"
                                                    disabled={saving}
                                                    onClick={() => { setEditingId(null); setEditValue(""); setError(null); }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            aria-label={`Editar presupuesto de ${cat?.label ?? entry.budget.category}`}
                                            disabled={saving}
                                            onClick={() => {
                                                setAddingCategory(null);
                                                setEditingId(entry.budget.id);
                                                setEditValue(entry.budget.amount.toString());
                                                setError(null);
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>

                                <ProgressBar percentage={entry.percentage} />

                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">
                                        Gastado: <span className="font-mono font-semibold text-foreground">{formatEuros(entry.spent)}</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        Límite: <span className="font-mono font-semibold text-foreground">{formatEuros(entry.budget.amount)}</span>
                                    </span>
                                </div>
                            </GlassCard>
                        );
                    })}
                </section>
            )}

            {!loading && !loadError && unbudgetedCategories.length > 0 && (
                <section className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Sin presupuesto</h2>
                    </div>

                    {unbudgetedCategories.map((cat) => {
                        const Icon = getIconComponent(cat.iconName);
                        const isAdding = addingCategory === cat.key;

                        return (
                            <GlassCard key={cat.key} className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="h-10 w-10 rounded-xl flex items-center justify-center"
                                            style={{ backgroundColor: hexWithAlpha(cat.hex, 0.12) }}
                                        >
                                            <Icon className="h-5 w-5" style={{ color: cat.hex }} />
                                        </div>
                                        <p className="font-semibold text-sm">{cat.label}</p>
                                    </div>

                                    {isAdding ? (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min="0.01"
                                                    step="0.01"
                                                    aria-label="Importe del presupuesto"
                                                    disabled={saving}
                                                    value={addValue}
                                                    onChange={(e) => setAddValue(e.target.value)}
                                                    className="w-24 h-8 text-sm"
                                                    placeholder="0.00"
                                                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- focus the inline add-budget input the user just opened so they can type immediately
                                                    autoFocus
                                                />
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-[color:var(--positive)] hover:opacity-80"
                                                    aria-label="Guardar presupuesto"
                                                    onClick={() => handleAddBudget(cat.key)}
                                                    disabled={saving}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    aria-label="Cancelar"
                                                    disabled={saving}
                                                    onClick={() => { setAddingCategory(null); setAddValue(""); setError(null); }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            aria-label={`Añadir presupuesto de ${cat.label}`}
                                            disabled={saving}
                                            onClick={() => {
                                                setEditingId(null);
                                                setAddingCategory(cat.key);
                                                setAddValue("");
                                                setError(null);
                                            }}
                                        >
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </GlassCard>
                        );
                    })}
                </section>
            )}
        </div>
    );
}
