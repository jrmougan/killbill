"use client";

import { cn } from "@/lib/utils";
import { formatEuros, toEuros } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";

interface Member {
    id: string;
    name: string;
    avatar: string | null;
}

/**
 * Per-member net-balance list for groups of more than two members, where the
 * two-pan {@link VisualBalance} seesaw no longer maps to a single relationship.
 * Each row shows a member's global net position (green = owed by the group,
 * primary = owes the group). Balances are net cents keyed by userId — the same
 * map calculateBalances/the ledger produce, so the rows sum to zero.
 */
export function MemberBalanceList({
    members,
    balances,
    currentUserId,
    className,
}: {
    members: Member[];
    balances: Record<string, number>;
    currentUserId: string;
    className?: string;
}) {
    return (
        <ul className={cn("w-full px-6 pb-[22px] space-y-2", className)}>
            {members.map((m) => {
                let cents = balances[m.id] || 0;
                if (Math.abs(cents) < 1) cents = 0; // sub-cent noise = settled
                const isMe = m.id === currentUserId;
                return (
                    <li
                        key={m.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--surface))] border border-white/[0.06] px-3 py-2.5"
                    >
                        <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 shrink-0 rounded-full bg-[hsl(var(--surface-raised))] border border-white/[0.08] flex items-center justify-center overflow-hidden text-sm font-bold text-muted-foreground">
                                {isAvatarUrl(m.avatar) ? (
                                    // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                                    <img src={m.avatar!} alt={m.name} className="w-full h-full object-cover" />
                                ) : (
                                    m.name.charAt(0).toUpperCase()
                                )}
                            </span>
                            <span className="text-sm font-medium text-foreground truncate">
                                {m.name}
                                {isMe && <span className="text-muted-foreground font-normal"> (tú)</span>}
                            </span>
                        </div>
                        <span
                            className={cn(
                                "text-sm font-mono font-semibold shrink-0",
                                cents > 0 ? "text-emerald-400" : cents < 0 ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            {cents > 0 ? "+" : ""}
                            {formatEuros(toEuros(cents))}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
