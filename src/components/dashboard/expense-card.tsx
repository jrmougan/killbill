"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Expense, User } from "@/types";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { getCategoryById } from "@/lib/categories";

interface ExpenseCardProps {
    expense: Expense;
    paidByUser: User;
    allUsers?: Record<string, User>;
}

export function ExpenseCard({ expense, paidByUser, allUsers }: ExpenseCardProps) {
    const category = getCategoryById(expense.category);
    const Icon = category.icon || Receipt;
    const colorClass = `${category.color} ${category.bgColor}`;

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
            <GlassCard className="flex items-center gap-4 hover:scale-[1.02] active:scale-95 cursor-pointer border-white/5">
                <div className={`p-3 rounded-xl ${colorClass}`}>
                    <Icon size={20} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate text-base">{expense.description}</h3>
                        {expense.receiptUrl && <Receipt size={12} className="text-primary shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <span className="font-medium text-foreground/80">{paidByUser.name}</span> pagó
                        </p>
                        <span className="h-1 w-1 rounded-full bg-white/20"></span>
                        <p className="text-[10px] font-bold text-primary/80 uppercase tracking-tighter">
                            {beneficiaryText}
                        </p>
                    </div>
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
