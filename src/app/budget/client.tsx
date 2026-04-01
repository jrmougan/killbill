"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Check, X } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, getAllCategories } from "@/lib/categories";

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

interface BudgetClientProps {
    budgetData: BudgetEntry[];
    monthLabel: string;
}

function ProgressBar({ percentage }: { percentage: number }) {
    const clamped = Math.min(percentage, 100);
    const colorClass =
        percentage > 100
            ? "bg-red-500"
            : percentage >= 80
            ? "bg-yellow-400"
            : "bg-emerald-500";

    return (
        <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
                className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                style={{ width: `${clamped}%` }}
            />
        </div>
    );
}

export function BudgetClient({ budgetData, monthLabel }: BudgetClientProps) {
    const router = useRouter();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [addingCategory, setAddingCategory] = useState<string | null>(null);
    const [addValue, setAddValue] = useState("");
    const [saving, setSaving] = useState(false);

    const budgetedCategories = new Set(budgetData.map((b) => b.budget.category));
    const unbudgetedCategories = getAllCategories().filter(
        (cat) => !budgetedCategories.has(cat.id)
    );

    const handleSaveEdit = async (entry: BudgetEntry) => {
        const amount = parseFloat(editValue);
        if (isNaN(amount) || amount < 0) return;
        setSaving(true);
        try {
            await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: entry.budget.category, amount }),
            });
            router.refresh();
        } finally {
            setSaving(false);
            setEditingId(null);
            setEditValue("");
        }
    };

    const handleAddBudget = async (categoryId: string) => {
        const amount = parseFloat(addValue);
        if (isNaN(amount) || amount < 0) return;
        setSaving(true);
        try {
            await fetch("/api/budget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: categoryId, amount }),
            });
            router.refresh();
        } finally {
            setSaving(false);
            setAddingCategory(null);
            setAddValue("");
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-10">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-xl font-bold">Presupuestos</h1>
                    <p className="text-xs text-muted-foreground capitalize">{monthLabel}</p>
                </div>
            </header>

            {budgetData.length === 0 && unbudgetedCategories.length === getAllCategories().length ? (
                <GlassCard className="p-8 text-center space-y-3">
                    <div className="text-5xl">📊</div>
                    <h2 className="text-lg font-bold">Sin presupuestos aún</h2>
                    <p className="text-sm text-muted-foreground">
                        Empieza definiendo cuánto quieres gastar por categoría
                    </p>
                </GlassCard>
            ) : null}

            {budgetData.length > 0 && (
                <section className="space-y-3">
                    {budgetData.map((entry) => {
                        const cat = CATEGORIES[entry.budget.category];
                        const Icon = cat?.icon;
                        const isEditing = editingId === entry.budget.id;

                        return (
                            <GlassCard key={entry.budget.id} className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cat?.bgColor ?? "bg-white/10"}`}>
                                            {Icon && <Icon className={`h-5 w-5 ${cat?.color ?? "text-white"}`} />}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm">{cat?.label ?? entry.budget.category}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {entry.percentage}%
                                            </p>
                                        </div>
                                    </div>

                                    {isEditing ? (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                className="w-24 h-8 text-sm"
                                                placeholder="0.00"
                                                autoFocus
                                            />
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                                                onClick={() => handleSaveEdit(entry)}
                                                disabled={saving}
                                            >
                                                <Check className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-muted-foreground hover:text-white"
                                                onClick={() => { setEditingId(null); setEditValue(""); }}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-white"
                                            onClick={() => {
                                                setEditingId(entry.budget.id);
                                                setEditValue(entry.budget.amount.toString());
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>

                                <ProgressBar percentage={entry.percentage} />

                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">
                                        Gastado: <span className="font-mono font-semibold text-foreground">{entry.spent.toFixed(2)}€</span>
                                    </span>
                                    <span className="text-muted-foreground">
                                        Límite: <span className="font-mono font-semibold text-foreground">{entry.budget.amount.toFixed(2)}€</span>
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
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={addValue}
                                                onChange={(e) => setAddValue(e.target.value)}
                                                className="w-24 h-8 text-sm"
                                                placeholder="0.00"
                                                autoFocus
                                            />
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                                                onClick={() => handleAddBudget(cat.id)}
                                                disabled={saving}
                                            >
                                                <Check className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-muted-foreground hover:text-white"
                                                onClick={() => { setAddingCategory(null); setAddValue(""); }}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-white"
                                            onClick={() => {
                                                setAddingCategory(cat.id);
                                                setAddValue("");
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
