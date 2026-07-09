"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Check, X } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, getAllCategories } from "@/lib/categories";
import { formatEuros } from "@/lib/currency";

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

export function BudgetClient({ budgetData, monthLabel, hasCouple = true }: BudgetClientProps) {
    const router = useRouter();
    const [scope, setScope] = useState<BudgetScope>(hasCouple ? "shared" : "personal");
    const [data, setData] = useState<BudgetEntry[]>(budgetData);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [addingCategory, setAddingCategory] = useState<string | null>(null);
    const [addValue, setAddValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reload the current scope's budgets from the API (personal or shared).
    const reload = useCallback(async (s: BudgetScope) => {
        const res = await fetch(`/api/budget?scope=${s}`);
        const json = res.ok ? await res.json() : { budgets: [] };
        setData(json.budgets ?? []);
    }, []);

    // The server pre-renders the SHARED budgets; only refetch when the scope
    // actually changes (skip the initial shared render).
    const didMount = useRef(false);
    useEffect(() => {
        if (!didMount.current) {
            didMount.current = true;
            if (scope === "shared") return; // already have server data
        }
        reload(scope);
    }, [scope, reload]);

    const budgetedCategories = new Set(data.map((b) => b.budget.category));
    const unbudgetedCategories = getAllCategories().filter(
        (cat) => !budgetedCategories.has(cat.id)
    );

    const handleSaveEdit = async (entry: BudgetEntry) => {
        const amount = parseFloat(editValue.replace(",", "."));
        if (isNaN(amount) || amount < 0) {
            setError("Introduce un importe válido");
            return;
        }
        setError(null);
        setSaving(true);
        try {
            await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: entry.budget.category, amount, scope }),
            });
            await reload(scope);
            router.refresh();
        } finally {
            setSaving(false);
            setEditingId(null);
            setEditValue("");
        }
    };

    const handleAddBudget = async (categoryId: string) => {
        const amount = parseFloat(addValue.replace(",", "."));
        if (isNaN(amount) || amount < 0) {
            setError("Introduce un importe válido");
            return;
        }
        setError(null);
        setSaving(true);
        try {
            await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: categoryId, amount, scope }),
            });
            await reload(scope);
            router.refresh();
        } finally {
            setSaving(false);
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
                            aria-pressed={scope === key}
                            className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-all ${scope === key ? "bg-primary text-white shadow" : "text-muted-foreground"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {data.length === 0 && unbudgetedCategories.length === getAllCategories().length ? (
                <GlassCard className="p-8 text-center space-y-3">
                    <div className="text-5xl">📊</div>
                    <h2 className="text-lg font-bold">Sin presupuestos aún</h2>
                    <p className="text-sm text-muted-foreground">
                        Empieza definiendo cuánto quieres gastar por categoría
                    </p>
                </GlassCard>
            ) : null}

            {data.length > 0 && (
                <section className="space-y-3">
                    {data.map((entry) => {
                        const cat = CATEGORIES[entry.budget.category];
                        const Icon = cat?.icon;
                        const isEditing = editingId === entry.budget.id;

                        return (
                            <GlassCard key={entry.budget.id} className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cat?.bgColor ?? "bg-secondary"}`}>
                                            {Icon && <Icon className={`h-5 w-5 ${cat?.color ?? "text-foreground"}`} />}
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
                                                    min="0"
                                                    step="0.01"
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
                                                    onClick={() => handleSaveEdit(entry)}
                                                    disabled={saving}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    onClick={() => { setEditingId(null); setEditValue(""); setError(null); }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            {error && <p className="text-xs text-destructive">{error}</p>}
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => {
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

            {unbudgetedCategories.length > 0 && (
                <section className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Sin presupuesto</h2>
                    </div>

                    {unbudgetedCategories.map((cat) => {
                        const Icon = cat.icon;
                        const isAdding = addingCategory === cat.id;

                        return (
                            <GlassCard key={cat.id} className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cat.bgColor}`}>
                                            <Icon className={`h-5 w-5 ${cat.color}`} />
                                        </div>
                                        <p className="font-semibold text-sm">{cat.label}</p>
                                    </div>

                                    {isAdding ? (
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
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
                                                    onClick={() => handleAddBudget(cat.id)}
                                                    disabled={saving}
                                                >
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    onClick={() => { setAddingCategory(null); setAddValue(""); setError(null); }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            {error && <p className="text-xs text-destructive">{error}</p>}
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={() => {
                                                setAddingCategory(cat.id);
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
