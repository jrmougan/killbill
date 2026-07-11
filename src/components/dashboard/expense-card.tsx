"use client";

import { Expense, User } from "@/types";
import Link from "next/link";
import { Lock } from "lucide-react";
import { CategoryBadge, type CategoryBadgeMeta } from "@/components/category/category-badge";

interface ExpenseCardProps {
    expense: Expense;
    paidByUser: User;
    allUsers?: Record<string, User>;
    isPersonal?: boolean;
    /** DB-driven category metadata (resolved server-side from the effective set). */
    categoryMeta?: CategoryBadgeMeta | null;
}

// Minimalist recent-expense row (EQUIL - Flujo de Gastos redesign):
// flat surface, category emoji in a neutral rounded square, "{quién} pagó · {badge}".
export function ExpenseCard({ expense, paidByUser, allUsers, isPersonal = false, categoryMeta }: ExpenseCardProps) {
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
            <div className="flex items-center gap-[13px] p-[13px] rounded-2xl bg-card border border-[color:var(--line-2)] cursor-pointer transition-all duration-150 hover:border-[color:var(--accent-border)] active:scale-[0.99] min-w-0">
                <CategoryBadge meta={categoryMeta} variant="emoji" size={42} radius={11} />

                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate text-[15px] text-foreground">{expense.description}</h3>
                    <div className="flex items-center gap-[7px] mt-[3px] min-w-0">
                        {isPersonal ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                                <Lock className="h-3 w-3" /> Personal
                            </span>
                        ) : (
                            <>
                                <span className="text-[11px] text-muted-foreground truncate">{paidByUser.name} pagó</span>
                                <span className="h-[2px] w-[2px] rounded-full bg-[color:var(--ink-3)] shrink-0" />
                                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{beneficiaryText}</span>
                            </>
                        )}
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
