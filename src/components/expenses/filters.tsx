"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Search, X, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllCategories } from "@/lib/categories";

interface ExpenseFiltersProps {
    onFiltersChange: (filters: {
        search: string;
        categories: string[];
        dateRange: "all" | "week" | "month" | "year";
    }) => void;
}

export function ExpenseFilters({ onFiltersChange }: ExpenseFiltersProps) {
    const [search, setSearch] = useState("");
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState<"all" | "week" | "month" | "year">("all");
    const [showFilters, setShowFilters] = useState(false);

    const categories = getAllCategories();

    const handleSearchChange = (value: string) => {
        setSearch(value);
        onFiltersChange({ search: value, categories: selectedCategories, dateRange });
    };

    const toggleCategory = (catId: string) => {
        const newCategories = selectedCategories.includes(catId)
            ? selectedCategories.filter(c => c !== catId)
            : [...selectedCategories, catId];
        setSelectedCategories(newCategories);
        onFiltersChange({ search, categories: newCategories, dateRange });
    };

    const handleDateRangeChange = (range: "all" | "week" | "month" | "year") => {
        setDateRange(range);
        onFiltersChange({ search, categories: selectedCategories, dateRange: range });
    };

    const clearFilters = () => {
        setSearch("");
        setSelectedCategories([]);
        setDateRange("all");
        onFiltersChange({ search: "", categories: [], dateRange: "all" });
    };

    const hasActiveFilters = search || selectedCategories.length > 0 || dateRange !== "all";

    return (
        <div className="space-y-3">
            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar gastos..."
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-10 pr-10"
                />
                {search && (
                    <button
                        onClick={() => handleSearchChange("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(
                        "flex items-center gap-2",
                        hasActiveFilters && "text-primary"
                    )}
                >
                    <Filter className="h-4 w-4" />
                    Filtros
                    {hasActiveFilters && (
                        <span className="bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                            {selectedCategories.length + (dateRange !== "all" ? 1 : 0)}
                        </span>
                    )}
                    {showFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>

                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        className="text-muted-foreground hover:text-white"
                    >
                        Limpiar
                    </Button>
                )}
            </div>

            {/* Expanded Filters */}
            {showFilters && (
                <GlassCard className="p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Categories */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Categorías
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => toggleCategory(cat.id)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5",
                                        selectedCategories.includes(cat.id)
                                            ? "bg-primary text-white"
                                            : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                                    )}
                                >
                                    <span>{cat.emoji}</span>
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Date Range */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Período
                        </label>
                        <div className="flex gap-2">
                            {[
                                { id: "all", label: "Todo" },
                                { id: "week", label: "Esta semana" },
                                { id: "month", label: "Este mes" },
                                { id: "year", label: "Este año" },
                            ].map(range => (
                                <button
                                    key={range.id}
                                    onClick={() => handleDateRangeChange(range.id as any)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                        dateRange === range.id
                                            ? "bg-primary text-white"
                                            : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                                    )}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </GlassCard>
            )}
        </div>
    );
}
