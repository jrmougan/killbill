import { EqCard, EqLabel } from "@/components/ui/eq";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { CategoryGlyph } from "./category-glyph";
import { sharePercent } from "./format";
import type { MonthAnalysis, MonthCategory } from "./types";

function Kpi({
    label,
    value,
    sub,
    testId,
    className,
}: {
    label: string;
    value: string;
    sub?: string;
    testId?: string;
    className?: string;
}) {
    return (
        <div className={cn("min-w-0 rounded-2xl bg-card border border-[color:var(--line-2)] px-3 py-2.5", className)}>
            <div className="text-[11.5px] text-muted-foreground truncate">{label}</div>
            <div data-testid={testId} className="text-[13px] min-[360px]:text-[15px] font-bold tracking-[-0.01em] tabular-nums break-words">
                {value}
            </div>
            {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
    );
}

/** 6-month bars: total (light) with "tu parte" nested inside (shared scope). */
function MonthBars({ months }: { months: MonthAnalysis["months"] }) {
    const shared = months.some((m) => m.myShare !== null);
    const max = Math.max(...months.map((m) => m.total), 1);
    const describe = (m: MonthAnalysis["months"][number]) =>
        `${m.label}: ${formatCurrency(m.total)}${m.myShare !== null ? `, tu parte ${formatCurrency(m.myShare)}` : ""}`;
    return (
        <figure aria-label="Gasto de los últimos 6 meses" className="flex flex-col gap-2.5 m-0">
            {shared && (
                <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground" aria-hidden>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent-softer)]" /> Total del espacio
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--positive)]" /> Tu parte
                    </span>
                </div>
            )}
            <div className="h-[120px] flex items-end gap-2.5">
                {months.map((m, i) => {
                    const isCurrent = i === months.length - 1;
                    const isPrev = i === months.length - 2;
                    const h = Math.max(3, (m.total / max) * 100);
                    return (
                        <div
                            key={`${m.label}-${i}`}
                            title={describe(m)}
                            className="flex-1 h-full flex items-end"
                        >
                            <div
                                className="relative w-full rounded-t-[6px] rounded-b-[2px] overflow-hidden transition-[height] duration-300"
                                style={{
                                    height: `${h}%`,
                                    background: shared
                                        ? "var(--accent-softer)"
                                        : isCurrent
                                            ? "var(--positive)"
                                            : isPrev
                                                ? "var(--accent-softer)"
                                                : "var(--surface-raised-hex)",
                                }}
                            >
                                {shared && m.total > 0 && (
                                    <div
                                        className="absolute inset-x-0 bottom-0 border-t-2 border-[color:var(--surface-hex)]"
                                        style={{
                                            height: `${Math.min(100, ((m.myShare ?? 0) / m.total) * 100)}%`,
                                            background: "var(--positive)",
                                        }}
                                    />
                                )}
                            </div>
                        </div>
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
            <figcaption className="sr-only">{months.map(describe).join(", ")}</figcaption>
        </figure>
    );
}

/** Caller's balance at each month end: one line around a zero baseline. */
function BalanceChart({ points }: { points: { label: string; balance: number }[] }) {
    const W = 300;
    const H = 110;
    const PAD = 10;
    const values = points.map((p) => p.balance);
    const hi = Math.max(0, ...values);
    const lo = Math.min(0, ...values);
    const span = hi - lo || 1;
    const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
    const y = (v: number) => PAD + ((hi - v) / span) * (H - 2 * PAD);
    const last = points[points.length - 1];
    const tone = (v: number) => (v > 0 ? "var(--positive)" : v < 0 ? "var(--negative)" : "var(--ink-3)");
    const word = (v: number) =>
        v > 0 ? `te deben ${formatCurrency(v)}` : v < 0 ? `debes ${formatCurrency(-v)}` : "en paz";

    return (
        <figure aria-label="Evolución de tu saldo en el espacio" className="flex flex-col gap-2 m-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[13px] text-muted-foreground whitespace-nowrap">A fin de {last.label}</span>
                <span data-testid="balance-now" className="text-[15px] font-bold whitespace-nowrap">
                    {last.balance > 0 ? "Te deben " : last.balance < 0 ? "Debes " : "En paz"}
                    {last.balance !== 0 && formatCurrency(Math.abs(last.balance))}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px] overflow-visible" role="presentation">
                <line
                    x1={PAD}
                    x2={W - PAD}
                    y1={y(0)}
                    y2={y(0)}
                    stroke="var(--ink-4)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                />
                <polyline
                    points={points.map((p, i) => `${x(i)},${y(p.balance)}`).join(" ")}
                    fill="none"
                    stroke="var(--ink-2)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                {points.map((p, i) => (
                    <g key={`${p.label}-${i}`}>
                        <circle cx={x(i)} cy={y(p.balance)} r={4} fill={tone(p.balance)} stroke="var(--surface-hex)" strokeWidth={2} />
                        {/* Larger invisible hit target for the hover tooltip. */}
                        <circle cx={x(i)} cy={y(p.balance)} r={12} fill="transparent">
                            <title>{`${p.label}: ${word(p.balance)}`}</title>
                        </circle>
                    </g>
                ))}
            </svg>
            <div className="flex justify-between text-[11px] text-muted-foreground px-[3%]" aria-hidden>
                {points.map((p, i) => (
                    <span key={`${p.label}-${i}`} className={cn(i === points.length - 1 && "text-foreground font-semibold")}>
                        {p.label}
                    </span>
                ))}
            </div>
            <figcaption className="sr-only">
                {points.map((p) => `${p.label}: ${word(p.balance)}`).join(", ")}
            </figcaption>
        </figure>
    );
}

export function AnalysisView({
    analysis,
    categories,
    prevMonthShort,
}: {
    analysis: MonthAnalysis;
    categories: MonthCategory[];
    prevMonthShort: string;
}) {
    const { months, byCategory, myShare, topExpenses, topItems, comparison, kpis, balance } = analysis;
    const total = months[months.length - 1]?.total ?? 0;
    const labelOf = (key: string) => categories.find((c) => c.key === key)?.label ?? key;
    const showBalance = balance !== null && balance.some((p) => p.balance !== 0);

    return (
        <>
            <section aria-label="Gasto del mes" className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Gastado este mes</span>
                <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span data-testid="month-total" className="text-[length:clamp(30px,11vw,44px)] font-bold tracking-[-0.03em] leading-none tabular-nums">
                        {formatCurrency(total)}
                    </span>
                    <span
                        data-testid="month-delta"
                        className={cn(
                            "text-[13px] font-semibold",
                            comparison.kind !== "delta"
                                ? "text-muted-foreground"
                                : comparison.percent > 0
                                    ? "text-[color:var(--negative)]"
                                    : "text-[color:var(--positive)]",
                        )}
                    >
                        {comparison.kind === "first"
                            ? "primer mes"
                            : comparison.kind === "zero"
                                ? `sin gastos en ${prevMonthShort}.`
                                : `${comparison.percent > 0 ? "+" : ""}${comparison.percent}% vs ${prevMonthShort}.`}
                    </span>
                </div>
                {myShare !== null && (
                    <span className="text-[12.5px] text-muted-foreground">
                        Tu parte: <span data-testid="month-my-share" className="font-semibold text-foreground tabular-nums">{formatCurrency(myShare)}</span>
                    </span>
                )}
            </section>

            <section aria-label="Indicadores" className="grid grid-cols-2 gap-2">
                <Kpi label="Media mensual" value={formatCurrency(kpis.avgMonthly)} sub="últimos 6 meses" testId="kpi-avg" />
                <Kpi
                    label="Nº de gastos"
                    value={String(kpis.count)}
                    sub={kpis.count > 0 ? `media ${formatCurrency(Math.round(total / kpis.count))}` : "este mes"}
                    testId="kpi-count"
                />
                <Kpi label="Categoría principal" value={kpis.topCategory ?? "—"} sub="este mes" testId="kpi-top" className="col-span-2" />
            </section>

            <EqCard className="p-4 flex flex-col gap-2.5">
                <MonthBars months={months} />
            </EqCard>

            {showBalance && (
                <section aria-labelledby="month-balance" className="flex flex-col gap-1">
                    <EqLabel id="month-balance" className="pb-1">Evolución de tu saldo</EqLabel>
                    <EqCard className="p-4">
                        <BalanceChart points={balance!} />
                    </EqCard>
                </section>
            )}

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
                                <span className="min-w-[88px] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums">
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
                                <span className="min-w-[88px] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums">
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
