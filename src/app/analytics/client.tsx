"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    Legend,
} from "recharts";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatEuros } from "@/lib/currency";

// Category hex colors aligned with the warm-light category catalog.
const CATEGORY_COLORS: Record<string, string> = {
    food: "#D9713C",
    shopping: "#A85C8A",
    rent: "#3F6F52",
    utilities: "#C9A227",
    transport: "#3E6E8E",
    entertainment: "#5B7A9E",
    health: "#C0554E",
    other: "#8B8477",
};

// Warm-light chart palette (hex literals for Recharts SVG props).
const ACCENT_HEX = "#BD5D3A";
const POSITIVE_HEX = "#3F6F52";
const NEGATIVE_HEX = "#C0554E";
const NEUTRAL_HEX = "#8B8477";
const GRID_STROKE = "rgba(139,132,119,0.22)";
const AXIS_TICK = "#8B8477";

interface MonthlySpending {
    month: string;
    total: number;
    myShare: number;
}

interface CategoryItem {
    category: string;
    amount: number;
    count: number;
    label: string;
}

interface BalancePoint {
    date: string;
    balance: number;
}

interface Stats {
    totalThisMonth: number;
    avgMonthly: number;
    topCategory: string;
    expensesThisMonthCount: number;
}

interface TopExpense {
    id: string;
    description: string;
    category: string;
    categoryLabel: string;
    amount: number;
    date: string;
}

interface TopItem {
    name: string;
    total: number;
    count: number;
    avgPrice: number;
}

interface Props {
    monthlySpending: MonthlySpending[];
    categoryBreakdown: CategoryItem[];
    balanceEvolution: BalancePoint[];
    stats: Stats;
    top5Expenses: TopExpense[];
    topItems: TopItem[];
}

const glassCard = "bg-card border border-[color:var(--line)] rounded-2xl p-4";

function StatCard({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <div className={glassCard}>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-1">{label}</p>
            <p className="text-xl font-mono font-semibold tracking-[-0.02em] text-foreground truncate">{value}</p>
            {sub && <p className="text-[11px] text-[color:var(--ink-3)] mt-0.5">{sub}</p>}
        </div>
    );
}

const chartTooltipStyle = {
    backgroundColor: "var(--surface-hex)",
    border: "1px solid var(--line)",
    borderRadius: "12px",
    color: "var(--ink)",
    fontSize: 12,
};

export function AnalyticsClient({
    monthlySpending,
    categoryBreakdown,
    balanceEvolution,
    stats,
    top5Expenses,
    topItems,
}: Props) {
    const lastBalance =
        balanceEvolution.length > 0
            ? balanceEvolution[balanceEvolution.length - 1].balance
            : 0;

    const balanceColor =
        lastBalance > 0 ? POSITIVE_HEX : lastBalance < 0 ? NEGATIVE_HEX : NEUTRAL_HEX;

    return (
        <div className="flex flex-col min-h-screen p-4 pb-24 space-y-6">
            {/* Header */}
            <header className="flex items-center gap-3 pt-2">
                <Link
                    href="/dashboard"
                    className="h-9 w-9 rounded-full bg-card border border-[color:var(--line)] flex items-center justify-center hover:bg-secondary transition-colors"
                >
                    <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-foreground">
                        Análisis
                    </h1>
                    <p className="text-xs text-muted-foreground">Últimos 6 meses</p>
                </div>
            </header>

            {/* Stat cards — 2x2 grid */}
            <section className="grid grid-cols-2 gap-3">
                <StatCard
                    label="Este mes"
                    value={formatEuros(stats.totalThisMonth)}
                    sub={`${stats.expensesThisMonthCount} ${stats.expensesThisMonthCount === 1 ? "gasto" : "gastos"}`}
                />
                <StatCard
                    label="Media mensual"
                    value={formatEuros(stats.avgMonthly)}
                    sub="últimos 6 meses"
                />
                <StatCard
                    label="Gasto medio por gasto"
                    value={formatEuros(
                        stats.expensesThisMonthCount > 0
                            ? stats.totalThisMonth / stats.expensesThisMonthCount
                            : 0
                    )}
                    sub="este mes"
                />
                <StatCard
                    label="Categoría top"
                    value={stats.topCategory}
                />
            </section>

            {/* Monthly bar chart */}
            <section className={glassCard}>
                <h2 className="text-sm font-semibold text-foreground mb-4">Gasto mensual</h2>
                <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={monthlySpending} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                        <XAxis
                            dataKey="month"
                            tick={{ fill: AXIS_TICK, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: AXIS_TICK, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            contentStyle={chartTooltipStyle}
                            cursor={{ fill: "rgba(139,132,119,0.12)" }}
                            formatter={(v) => formatEuros(Number(v))}
                        />
                        <Legend
                            verticalAlign="top"
                            height={24}
                            wrapperStyle={{ fontSize: 11, color: AXIS_TICK }}
                            formatter={(value) => value === "total" ? "Total grupo" : "Mi parte"}
                        />
                        <Bar dataKey="total" name="total" fill={ACCENT_HEX} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="myShare" name="myShare" fill={POSITIVE_HEX} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </section>

            {/* Category pie chart */}
            {categoryBreakdown.length > 0 ? (
                <section className={glassCard}>
                    <h2 className="text-sm font-semibold text-foreground mb-4">Por categoría (este mes)</h2>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie
                                    data={categoryBreakdown}
                                    dataKey="amount"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={75}
                                    innerRadius={40}
                                    paddingAngle={3}
                                >
                                    {categoryBreakdown.map((item) => (
                                        <Cell
                                            key={item.category}
                                            fill={CATEGORY_COLORS[item.category] ?? NEUTRAL_HEX}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={chartTooltipStyle}
                                    formatter={(v) => [formatEuros(Number(v)), ""]}
                                />
                            </PieChart>
                        </ResponsiveContainer>

                        {/* Legend */}
                        <ul className="w-full space-y-2">
                            {categoryBreakdown.map((item) => (
                                <li key={item.category} className="flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-2">
                                        <span
                                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? NEUTRAL_HEX }}
                                        />
                                        <span className="text-[color:var(--body-ink)]">{item.label}</span>
                                    </span>
                                    <span className="font-mono font-semibold tracking-[-0.02em] text-foreground">{formatEuros(item.amount)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            ) : (
                <section className={`${glassCard} text-center py-8`}>
                    <p className="text-[color:var(--ink-3)] text-sm">Sin gastos este mes</p>
                </section>
            )}

            {/* Balance evolution line chart */}
            <section className={glassCard}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-foreground">Evolución del balance</h2>
                    <span
                        className="flex items-center gap-1 text-xs font-mono font-semibold tracking-[-0.02em]"
                        style={{ color: balanceColor }}
                    >
                        {lastBalance > 0 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                        ) : lastBalance < 0 ? (
                            <TrendingDown className="h-3.5 w-3.5" />
                        ) : (
                            <Minus className="h-3.5 w-3.5" />
                        )}
                        {`${lastBalance > 0 ? "+" : ""}${formatEuros(lastBalance)}`}
                    </span>
                </div>
                {balanceEvolution.length > 1 ? (
                    <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={balanceEvolution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: AXIS_TICK, fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tick={{ fill: AXIS_TICK, fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                contentStyle={chartTooltipStyle}
                                formatter={(v) => [formatEuros(Number(v)), "Balance"]}
                            />
                            <Line
                                type="monotone"
                                dataKey="balance"
                                stroke={balanceColor}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, fill: balanceColor }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-[color:var(--ink-3)] text-sm text-center py-8">Sin suficientes datos</p>
                )}
            </section>

            {/* Top 5 expenses */}
            <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground ml-1">Top gastos del mes</h2>
                {top5Expenses.length === 0 ? (
                    <div className={`${glassCard} text-center py-8`}>
                        <p className="text-[color:var(--ink-3)] text-sm">Sin gastos este mes</p>
                    </div>
                ) : (
                    top5Expenses.map((expense, idx) => (
                        <div
                            key={expense.id}
                            className="bg-card border border-[color:var(--line-2)] rounded-[14px] p-4 flex items-center gap-3"
                        >
                            <span className="text-lg font-mono font-semibold text-[color:var(--ink-3)] w-5 text-center flex-shrink-0">
                                {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{expense.description}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {expense.categoryLabel} · {expense.date}
                                </p>
                            </div>
                            <span className="text-base font-mono font-semibold tracking-[-0.02em] text-foreground flex-shrink-0">
                                {formatEuros(expense.amount)}
                            </span>
                        </div>
                    ))
                )}
            </section>

            {/* Top products from receipt breakdowns */}
            {topItems.length > 0 && (
                <section className={glassCard}>
                    <h2 className="text-sm font-semibold text-foreground mb-1">Top productos (últimos 3 meses)</h2>
                    <p className="text-[11px] text-[color:var(--ink-3)] mb-4">Basado en los desgloses de tickets escaneados</p>
                    <div className="space-y-3">
                        {(() => {
                            const maxTotal = topItems[0]?.total ?? 1;
                            return topItems.map((item, idx) => (
                                <div key={item.name} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="text-[color:var(--ink-3)] font-mono w-4 flex-shrink-0">{idx + 1}</span>
                                            <span className="text-[color:var(--body-ink)] truncate font-medium">{item.name}</span>
                                        </span>
                                        <span className="font-mono font-semibold tracking-[-0.02em] text-foreground flex-shrink-0 ml-2">
                                            {formatEuros(item.total)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-primary"
                                                style={{ width: `${(item.total / maxTotal) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-[color:var(--ink-3)] flex-shrink-0 w-20 text-right">
                                            {item.count}× · {formatEuros(item.avgPrice)}/u
                                        </span>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </section>
            )}
        </div>
    );
}
