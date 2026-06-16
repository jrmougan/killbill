"use client";

import { Expense, User } from "@/types";
import Link from "next/link";
import { getCategoryById } from "@/lib/categories";

interface ExpenseCardProps {
    expense: Expense;
    paidByUser: User;
    allUsers?: Record<string, User>;
}

// Minimalist recent-expense row (EQUIL - Flujo de Gastos redesign):
// flat surface, category emoji in a neutral rounded square, "{quién} pagó · {badge}".
export function ExpenseCard({ expense, paidByUser, allUsers }: ExpenseCardProps) {
    const category = getCategoryById(expense.category);

    // Determine beneficiary info
    let beneficiaryText = "Común";
    if (expense.splits.length === 1 && allUsers) {
        const beneficiaryId = expense.splits[0].userId;
        const beneficiary = allUsers[beneficiaryId];
        if (beneficiary) {
            if (beneficiaryId !== paidByUser.id) {
                beneficiaryText = `Favor para ${beneficiary.name.split(' ')[0]}`;
            } else {
                beneficiaryText = "Personal";
            }
        }
    }

    return (
        <Link href={`/expense/${expense.id}`}>
            <div className="flex items-center gap-[13px] p-[13px] rounded-2xl bg-[hsl(var(--surface))] border border-white/5 cursor-pointer transition-all duration-150 hover:border-white/[0.14] active:scale-[0.99] min-w-0">
                <div className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center text-xl shrink-0 bg-[hsl(var(--surface-raised))] border border-white/5">
                    {category.emoji}
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate text-[15px] text-foreground">{expense.description}</h3>
                    <div className="flex items-center gap-[7px] mt-[3px]">
                        <span className="text-[11px] text-muted-foreground">{paidByUser.name} pagó</span>
                        <span className="h-[2px] w-[2px] rounded-full bg-white/20" />
                        <span className="text-[11px] text-muted-foreground">{beneficiaryText}</span>
                    </div>
                </div>

                <div className="text-right shrink-0">
                    <span className="block font-semibold text-[15px] font-mono text-foreground">
                        {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(expense.amount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {new Date(expense.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                    </span>
                </div>
            </div>
        </Link>
    );
}
