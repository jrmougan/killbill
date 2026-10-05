import { EqCard, EqLabel } from "@/components/ui/eq";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { CategoryGlyph } from "./category-glyph";
import { deltaPercent, sharePercent } from "./format";
import type { MonthAnalysis, MonthCategory } from "./types";

export function AnalysisView({
    analysis,
    categories,
    prevMonthShort,
}: {
    analysis: MonthAnalysis;
    categories: MonthCategory[];
    prevMonthShort: string;
}) {
    const { months, byCategory, myShare, topExpenses, topItems } = analysis;
    const total = months[months.length - 1]?.total ?? 0;
    const prev = months[months.length - 2]?.total ?? 0;
    const diff = deltaPercent(total, prev);
    const max = Math.max(...months.map((m) => m.total), 1);
    const labelOf = (key: string) => categories.find((c) => c.key === key)?.label ?? key;

    return (
        <>
            <section aria-label="Gasto del mes" className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Gastado este mes</span>
                <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span data-testid="month-total" className="text-[44px] font-bold tracking-[-0.03em] leading-none tabular-nums">
                        {formatCurrency(total)}
                    </span>
                    <span
                        className={cn(
                            "text-[13px] font-semibold",
                            diff === null ? "text-muted-foreground" : diff > 0 ? "text-[color:var(--negative)]" : "text-[color:var(--positive)]",
                        )}
                    >
                        {diff === null ? "primer mes" : `${diff > 0 ? "+" : ""}${diff}% vs ${prevMonthShort}.`}
                    </span>
                </div>
                {myShare !== null && (
                    <span className="text-[12.5px] text-muted-foreground">
                        Tu parte: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(myShare)}</span>
                    </span>
                )}
            </section>

            <EqCard className="p-4 flex flex-col gap-2.5">
                <figure aria-label="Gasto de los últimos 6 meses" className="flex flex-col gap-2.5">
                    <div className="h-[120px] flex items-end gap-2.5">
                        {months.map((m, i) => {
                            const isCurrent = i === months.length - 1;
                            const isPrev = i === months.length - 2;
                            return (
                                <div
                                    key={`${m.label}-${i}`}
                                    title={`${m.label}: ${formatCurrency(m.total)}`}
                                    className="flex-1 rounded-t-[6px] rounded-b-[2px] transition-[height] duration-300"
                                    style={{
                                        height: `${Math.max(3, (m.total / max) * 100)}%`,
                                        background: isCurrent
                                            ? "var(--positive)"
                                            : isPrev
                                                ? "var(--accent-softer)"
                                                : "var(--surface-raised-hex)",
                                    }}
                                />
                            );
                        })}
                    </div>
                    <div className="flex gap-2.5 text-[11px] text-center">
                        {months.map((m, i) => (
                            <span
                                key={`${m.label}-${i}`}
                                className={cn(
                                    "flex-1",
                                    i === months.length - 1 ? "text-foreground font-semibold" : "text-muted-foreground",
                                )}
                            >
                                {m.label}
                            </span>
                        ))}
                    </div>
                    <figcaption className="sr-only">
                        {months.map((m) => `${m.label}: ${formatCurrency(m.total)}`).join(", ")}
                    </figcaption>
                </figure>
            </EqCard>

            <section aria-labelledby="month-by-category" className="flex flex-col">
                <EqLabel id="month-by-category" className="pb-1">Por categoría</EqLabel>
                {byCategory.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Sin gastos este mes.</p>
                ) : (
                    <ul>
                        {byCategory.map((c) => (
                            <li key={c.key} className="flex items-center gap-2.5 py-[9px]">
                                <span className="w-6 text-[17px] flex justify-center">
                                    <CategoryGlyph category={c} />
                                </span>
                                <span className="flex-1 min-w-0 truncate text-sm font-semibold">{c.label}</span>
                                <span className="w-10 text-right text-[13px] text-muted-foreground tabular-nums">
                                    {sharePercent(c.amount, total)}%
                                </span>
                                <span className="w-[88px] text-right text-sm font-semibold tabular-nums">
                                    {formatCurrency(c.amount)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {topExpenses.length > 0 && (
                <section aria-labelledby="month-top-expenses" className="flex flex-col">
                    <EqLabel id="month-top-expenses" className="pb-1">Gastos más grandes</EqLabel>
                    <ul>
                        {topExpenses.map((e) => (
                            <li key={e.id} className="flex items-center gap-2.5 py-[9px]">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold truncate">{e.description}</div>
                                    <div className="text-[12.5px] text-muted-foreground truncate">
                                        {labelOf(e.category)} · {e.date}
                                    </div>
                                </div>
                                <span className="text-sm font-semibold tabular-nums">{formatCurrency(e.amount)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {topItems.length > 0 && (
                <section aria-labelledby="month-top-items" className="flex flex-col">
                    <EqLabel id="month-top-items" className="pb-1">Lo más comprado · 3 meses</EqLabel>
                    <ul>
                        {topItems.map((item) => (
                            <li key={item.name} className="flex items-center gap-2.5 py-[9px]">
                                <span className="flex-1 min-w-0 truncate text-sm font-semibold">{item.name}</span>
                                <span className="text-[13px] text-muted-foreground tabular-nums">{item.count}×</span>
                                <span className="w-[88px] text-right text-sm font-semibold tabular-nums">
                                    {formatCurrency(item.total)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
