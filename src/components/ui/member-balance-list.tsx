import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { firstName } from "@/lib/home-format";
import { hasOpenBalance } from "@/lib/space-policy";
import { EqLabel } from "@/components/ui/eq";

export type MemberBalance = {
    id: string;
    name: string;
    avatar: string | null;
    /** Shadow guest (EPHEMERAL) — gets an "Invitado" badge. */
    isGuest?: boolean;
    /** Net cents from the ledger (+ the group owes them, − they owe the group). */
    balanceCents: number;
};

/**
 * "Saldos del grupo" (EQUIL): one compact row per ACTIVE member with their net
 * position in the space, for GROUP/EPHEMERAL spaces where a single "X te debe"
 * no longer tells the whole story. Balances come from the ledger and sum to zero.
 * Restores the per-member list the pre-redesign group dashboard had.
 */
export function MemberBalanceList({
    members,
    currentUserId,
    title = "Saldos del grupo",
    className,
}: {
    members: MemberBalance[];
    currentUserId: string;
    title?: string;
    className?: string;
}) {
    const sorted = [...members].sort((a, b) => b.balanceCents - a.balanceCents);
    return (
        <section aria-labelledby="member-balances-title" data-testid="member-balances" className={cn("flex flex-col", className)}>
            <EqLabel id="member-balances-title" className="pb-1">{title}</EqLabel>
            <ul className="flex flex-col divide-y divide-[color:var(--line-2)]">
                {sorted.map((m) => {
                    const open = hasOpenBalance(m.balanceCents);
                    const cents = open ? m.balanceCents : 0;
                    const isMe = m.id === currentUserId;
                    const words = !open ? "En paz" : cents > 0 ? (isMe ? "Te deben" : "Le deben") : isMe ? "Debes" : "Debe";
                    const avatarText = (m.avatar ?? "").trim() && !isAvatarUrl(m.avatar) ? m.avatar : m.name.charAt(0).toUpperCase();
                    return (
                        <li
                            key={m.id}
                            data-testid="member-balance-row"
                            className="flex items-center gap-3 py-2.5"
                        >
                            <span className="h-9 w-9 flex-none rounded-full bg-[var(--track)] flex items-center justify-center overflow-hidden text-sm font-bold text-muted-foreground" aria-hidden="true">
                                {isAvatarUrl(m.avatar) ? (
                                    // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions
                                    <img src={m.avatar!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                ) : (
                                    avatarText
                                )}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                                    <span className="truncate">{isMe ? "Tú" : firstName(m.name)}</span>
                                    {m.isGuest && (
                                        <span className="flex-none rounded-md bg-[var(--track)] px-1.5 py-px text-[11px] font-semibold text-muted-foreground">
                                            Invitado
                                        </span>
                                    )}
                                </span>
                                <span className="block text-[12.5px] text-muted-foreground">{words}</span>
                            </span>
                            <span
                                className={cn(
                                    "flex-none text-[15px] font-semibold tabular-nums",
                                    cents > 0 && "text-[color:var(--positive)]",
                                    cents < 0 && "text-[color:var(--negative)]",
                                    cents === 0 && "text-muted-foreground",
                                )}
                            >
                                {cents === 0 ? formatCurrency(0) : `${cents > 0 ? "+" : "−"}${formatCurrency(Math.abs(cents))}`}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
