"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Expense, User } from "@/types";
import { Coffee, Home, Lightbulb, TramFront, ShoppingBag, Receipt, ArrowRight } from "lucide-react";
import Link from "next/link";

interface ExpenseCardProps {
    expense: Expense;
    paidByUser: User; // Who paid
    forUser?: User; // If specific, or implied valid "other"
}

const CATEGORY_ICONS = {
    food: Coffee,
    rent: Home,
    utilities: Lightbulb,
    transport: TramFront,
    entertainment: ShoppingBag, // Or Ticket
    other: Receipt,
};

const CATEGORY_COLORS = {
    food: "text-orange-400 bg-orange-400/20",
    rent: "text-blue-400 bg-blue-400/20",
    utilities: "text-yellow-400 bg-yellow-400/20",
    transport: "text-green-400 bg-green-400/20",
    entertainment: "text-purple-400 bg-purple-400/20",
    other: "text-gray-400 bg-gray-400/20",
};

export function ExpenseCard({ expense, paidByUser }: ExpenseCardProps) {
    const Icon = CATEGORY_ICONS[expense.category] || Receipt;
    const colorClass = CATEGORY_COLORS[expense.category] || CATEGORY_COLORS.other;

    return (
        <Link href={`/expense/${expense.id}`}>
            <GlassCard className="flex items-center gap-4 hover:scale-[1.02] active:scale-95 cursor-pointer border-white/5">
                <div className={`p-3 rounded-xl ${colorClass}`}>
                    <Icon size={20} />
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate text-base">{expense.description}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="font-medium text-foreground/80">{paidByUser.name}</span> pagó
                    </p>
                </div>

                <div className="text-right">
                    <span className="block font-bold text-lg tracking-tight">
                        {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(expense.amount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {new Date(expense.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                    </span>
                </div>
            </GlassCard>
        </Link>
    );
}
