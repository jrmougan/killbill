"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowLeft, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { ExpenseFilters } from "@/components/expenses/filters";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { Expense, User } from "@/types";

interface ExpensesListClientProps {
    expenses: Expense[];
    usersMap: Record<string, User>;
}

export function ExpensesListClient({ expenses, usersMap }: ExpensesListClientProps) {
    const [filters, setFilters] = useState({
        search: "",
        categories: [] as string[],
        dateRange: "all" as "all" | "week" | "month" | "year",
    });

    const filteredExpenses = useMemo(() => {
        let result = [...expenses];

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

        return result;
    }, [expenses, filters]);

    const totalFiltered = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold">Todos los Gastos</h1>
                    <p className="text-xs text-muted-foreground">{expenses.length} gastos en total</p>
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
                        {filteredExpenses.length} resultado{filteredExpenses.length !== 1 ? "s" : ""}
                    </span>
                    <span className="font-bold text-primary">
                        {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(totalFiltered)}
                    </span>
                </div>
            )}

            {/* Expenses List */}
            <div className="space-y-3">
                {filteredExpenses.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                        <div className="text-5xl">🔍</div>
                        <div className="space-y-1">
                            <p className="font-bold text-lg">Sin resultados</p>
                            <p className="text-sm text-muted-foreground">
                                {filters.search
                                    ? `No hay gastos que coincidan con "${filters.search}"`
                                    : "No hay gastos con los filtros seleccionados"
                                }
                            </p>
                        </div>
                    </div>
                ) : (
                    filteredExpenses.map((expense) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            paidByUser={usersMap[expense.paidBy]}
                            allUsers={usersMap}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
