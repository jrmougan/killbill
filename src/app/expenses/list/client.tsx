"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowLeft, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { ExpenseFilters } from "@/components/expenses/filters";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { User, Expense } from "@/types";

interface UnifiedItem {
    id: string;
    type: "EXPENSE" | "SETTLEMENT";
    description: string;
    amount: number;
    date: string;
    category: string;
    paidBy: string;
    status: string;
    toUserId?: string;
    method?: string;
    receiptUrl?: string | null;
    splits?: { userId: string, amount: number }[];
}

interface ExpensesListClientProps {
    items: UnifiedItem[];
    usersMap: Record<string, User>;
}

export function ExpensesListClient({ items, usersMap }: ExpensesListClientProps) {
    const [filters, setFilters] = useState({
        search: "",
        categories: [] as string[],
        dateRange: "all" as "all" | "week" | "month" | "year",
        status: "pending" as "all" | "pending" | "settled",
    });

    const filteredItems = useMemo(() => {
        let result = [...items];

        // Search filter
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            result = result.filter(e =>
                e.description.toLowerCase().includes(searchLower)
            );
        }

        // Category filter
        if (filters.categories.length > 0) {
            result = result.filter(e => filters.categories.includes(e.category));
        }

        // Date range filter
        if (filters.dateRange !== "all") {
            const now = new Date();
            let startDate: Date;

            switch (filters.dateRange) {
                case "week":
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - 7);
                    break;
                case "month":
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case "year":
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
            }

            result = result.filter(e => new Date(e.date) >= startDate);
        }

        // Status filter
        if (filters.status === "pending") {
            result = result.filter(i => {
                if (i.type === "EXPENSE") return i.status === "OPEN";
                return i.status === "PENDING";
            });
        } else if (filters.status === "settled") {
            result = result.filter(i => {
                if (i.type === "EXPENSE") return i.status === "SETTLED";
                return i.status === "CONFIRMED";
            });
        }

        return result;
    }, [items, filters]);

    const totalFiltered = filteredItems
        .filter(i => i.type === "EXPENSE")
        .reduce((sum, e) => sum + e.amount, 0);

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold">Todos los Movimientos</h1>
                    <p className="text-xs text-muted-foreground">{items.length} registros en total</p>
                </div>
                <Link href="/expenses/new">
                    <Button size="icon" className="h-10 w-10 rounded-full shadow-lg">
                        <Plus className="h-5 w-5" />
                    </Button>
                </Link>
            </header>

            <ExpenseFilters onFiltersChange={setFilters} />

            {/* Results Summary */}
            {(filters.search || filters.categories.length > 0 || filters.dateRange !== "all") && (
                <div className="flex items-center justify-between text-sm animate-in fade-in duration-200">
                    <span className="text-muted-foreground">
                        {filteredItems.length} resultado{filteredItems.length !== 1 ? "s" : ""}
                    </span>
                    <span className="font-bold text-primary">
                        {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(totalFiltered)}
                    </span>
                </div>
            )}

            {/* Unified List */}
            <div className="space-y-3">
                {filteredItems.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                        <div className="text-5xl">🔍</div>
                        <div className="space-y-1">
                            <p className="font-bold text-lg">Sin resultados</p>
                            <p className="text-sm text-muted-foreground">
                                {filters.search
                                    ? `No hay elementos que coincidan con "${filters.search}"`
                                    : "No hay elementos con los filtros seleccionados"
                                }
                            </p>
                        </div>
                    </div>
                ) : (
                    filteredItems.map((item) => {
                        if (item.type === "EXPENSE") {
                            return (
                                <ExpenseCard
                                    key={item.id}
                                    expense={item as any}
                                    paidByUser={usersMap[item.paidBy]}
                                    allUsers={usersMap}
                                />
                            );
                        } else {
                            const fromUser = usersMap[item.paidBy];
                            const toUser = item.toUserId ? usersMap[item.toUserId] : null;

                            return (
                                <Link href={`/settle/${item.id}`} key={item.id}>
                                    <GlassCard className="p-4 flex items-center justify-between border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 transition-all border-l-4">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-xl">
                                                🤝
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-sm">Liquidación</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    {fromUser?.name} ha pagado a {toUser?.name}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {new Date(item.date).toLocaleDateString()} • {item.method}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-mono font-bold text-blue-400">
                                                {item.amount.toFixed(2)}€
                                            </p>
                                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                                {item.status}
                                            </span>
                                        </div>
                                    </GlassCard>
                                </Link>
                            );
                        }
                    })
                )}
            </div>
        </div>
    );
}
