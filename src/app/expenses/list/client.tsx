"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { EqChip, EqHeader, EqRow } from "@/components/ui/eq";
import type { CategoryBadgeMeta } from "@/components/category/category-badge";
import { formatCurrency } from "@/lib/currency";
import { getSettlementMethodLabel } from "@/lib/settlement-labels";
import { GuestBanner } from "@/components/guest/guest-banner";
import {
    EMPTY_FILTERS, ExpenseFiltersPanel, FiltersToggle, activeFilterCount, type AdvancedFilters,
} from "@/components/expenses/filters";
import { dayKey, dayLabel, expenseSubtitle, settlementText } from "@/components/expenses/list-format";

export type ListItem = {
    id: string;
    type: "EXPENSE" | "SETTLEMENT";
    description: string;
    amountCents: number;
    date: string;
    category: string;
    paidBy: string;
    categoryMeta?: CategoryBadgeMeta;
    splitStrategy?: string | null;
    splits?: { userId: string; amount: number }[];
    toUserId?: string;
    method?: string;
    status?: string;
};

type PayerFilter = "all" | "me" | "other";

const PAGE = 40;

function startOf(range: AdvancedFilters["dateRange"]): Date | null {
    const now = new Date();
    if (range === "week") { const d = new Date(now); d.setDate(now.getDate() - 7); return d; }
    if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === "year") return new Date(now.getFullYear(), 0, 1);
    return null;
}

export function ExpensesListClient({
    items,
    userId,
    members,
    spaceLabel,
    personal,
    isGuest = false,
    categories = [],
}: {
    items: ListItem[];
    userId: string;
    members: { id: string; name: string }[];
    spaceLabel: string;
    personal: boolean;
    isGuest?: boolean;
    categories?: CategoryBadgeMeta[];
}) {
    const [q, setQ] = useState("");
    const [payer, setPayer] = useState<PayerFilter>("all");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_FILTERS);
    const [visible, setVisible] = useState(PAGE);

    const shared = !personal && members.length > 1;
    const others = members.filter((m) => m.id !== userId);
    const payerChips: { value: PayerFilter; label: string }[] = [
        { value: "all", label: "Todos" },
        { value: "me", label: "Pagué yo" },
        { value: "other", label: others.length === 1 ? `Pagó ${others[0].name}` : "Pagaron otros" },
    ];

    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        const since = startOf(advanced.dateRange);
        return items.filter((e) => {
            const isSettle = e.type === "SETTLEMENT";
            if (!isSettle && payer === "me" && e.paidBy !== userId) return false;
            if (!isSettle && payer === "other" && e.paidBy === userId) return false;
            if (advanced.categories.length > 0 && (isSettle || !advanced.categories.includes(e.category))) return false;
            if (since && new Date(e.date) < since) return false;
            if (ql) {
                const amountText = formatCurrency(e.amountCents).toLowerCase();
                const raw = (e.amountCents / 100).toString();
                const text = isSettle ? `liquidación ${e.description}` : e.description;
                if (!text.toLowerCase().includes(ql) && !amountText.includes(ql) && !raw.includes(ql.replace(",", "."))) return false;
            }
            return true;
        });
    }, [items, q, payer, advanced, userId]);

    // Reset the window whenever the result set changes.
    useEffect(() => { setVisible(PAGE); }, [q, payer, advanced]);

    const groups = useMemo(() => {
        // Day totals come from the whole filtered set so a day cut by the
        // pagination window still shows its full total.
        const totals = new Map<string, number>();
        for (const e of filtered) {
            if (e.type === "EXPENSE") totals.set(dayKey(e.date), (totals.get(dayKey(e.date)) ?? 0) + e.amountCents);
        }
        const out: { key: string; label: string; total: number; items: ListItem[] }[] = [];
        for (const e of filtered.slice(0, visible)) {
            const key = dayKey(e.date);
            let g = out[out.length - 1];
            if (!g || g.key !== key) { g = { key, label: dayLabel(e.date), total: totals.get(key) ?? 0, items: [] }; out.push(g); }
            g.items.push(e);
        }
        return out;
    }, [filtered, visible]);

    // Infinite load: grow the window when the sentinel scrolls into view.
    const sentinel = useRef<HTMLDivElement>(null);
    const hasMore = filtered.length > visible;
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((en) => en.isIntersecting)) setVisible((v) => v + PAGE);
        }, { rootMargin: "300px" });
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, visible]);

    const filterCount = activeFilterCount(advanced);
    const anyFilter = q.trim() !== "" || payer !== "all" || filterCount > 0;

    return (
        <div className="eq-in flex flex-col w-full pt-3 pb-28">
            <div className="flex flex-col gap-3 px-5">
                <EqHeader title="Gastos" meta={spaceLabel} className="px-0 items-baseline" />
                <GuestBanner show={isGuest} />
                <label className="flex h-[42px] items-center gap-2 rounded-xl border border-[color:var(--line)] bg-card px-3 text-[color:var(--ink-3)]">
                    <Search className="h-[17px] w-[17px] flex-none" aria-hidden />
                    <input
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Buscar gasto"
                        aria-label="Buscar gasto"
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                    />
                </label>
                <div className="eq-scroll flex items-center gap-1.5 overflow-x-auto">
                    {shared && payerChips.map((c) => (
                        <EqChip key={c.value} selected={payer === c.value} onClick={() => setPayer(c.value)}>
                            {c.label}
                        </EqChip>
                    ))}
                    <FiltersToggle open={filtersOpen} count={filterCount} onToggle={() => setFiltersOpen((o) => !o)} />
                </div>
                {filtersOpen && <ExpenseFiltersPanel value={advanced} onChange={setAdvanced} categories={categories} />}
            </div>

            <div className="px-5 pt-3">
                {groups.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                        {anyFilter || items.length > 0 ? "No hay gastos que coincidan." : "Todavía no hay gastos."}
                    </p>
                ) : (
                    groups.map((g) => (
                        <section key={g.key} aria-label={g.label} className="flex flex-col">
                            <div className="flex justify-between pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
                                <span>{g.label}</span>
                                <span className="tabular-nums">{g.total > 0 ? formatCurrency(g.total) : ""}</span>
                            </div>
                            {g.items.map((e) => {
                                if (e.type === "SETTLEMENT") {
                                    const t = settlementText({
                                        meId: userId,
                                        fromId: e.paidBy,
                                        toId: e.toUserId,
                                        members,
                                        methodLabel: e.method ? getSettlementMethodLabel(e.method) : "",
                                        pending: e.status === "PENDING",
                                    });
                                    return (
                                        <EqRow
                                            key={e.id}
                                            href={`/settle/${e.id}`}
                                            icon={<Check className="h-5 w-5" />}
                                            iconTint
                                            title={t.title}
                                            sub={t.sub}
                                            amount={formatCurrency(e.amountCents)}
                                            amountClassName="text-primary"
                                        />
                                    );
                                }
                                return (
                                    <EqRow
                                        key={e.id}
                                        href={`/expense/${e.id}`}
                                        icon={<span aria-hidden>{e.categoryMeta?.emoji ?? "📦"}</span>}
                                        title={e.description}
                                        sub={shared
                                            ? expenseSubtitle({ meId: userId, paidBy: e.paidBy, members, splits: e.splits ?? [], splitStrategy: e.splitStrategy ?? null })
                                            : e.categoryMeta?.label ?? "Gasto"}
                                        amount={formatCurrency(e.amountCents)}
                                    />
                                );
                            })}
                        </section>
                    ))
                )}
                {hasMore && (
                    <div ref={sentinel} className="flex justify-center py-4">
                        <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                            Mostrar más
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
