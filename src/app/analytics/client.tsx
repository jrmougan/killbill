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

// Category hex colors aligned with CATEGORIES in src/lib/categories.ts
const CATEGORY_COLORS: Record<string, string> = {
    food: "#fb923c",        // orange-400
    shopping: "#f472b6",    // pink-400
    rent: "#60a5fa",        // blue-400
    utilities: "#facc15",   // yellow-400
    transport: "#4ade80",   // green-400
    entertainment: "#c084fc", // purple-400
    health: "#f87171",      // red-400
    other: "#9ca3af",       // gray-400
};

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

const glassCard = "bg-white/5 border border-white/10 rounded-xl backdrop-blur-md p-4";

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
            <p className="text-[11px] uppercase tracking-widest text-white/40 mb-1">{label}</p>
            <p className="text-xl font-mono font-bold text-white truncate">{value}</p>
            {sub && <p className="text-[11px] text-white/40 mt-0.5">{sub}</p>}
        </div>
    );
}

const chartTooltipStyle = {
    backgroundColor: "rgba(0,0,0,0.85)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "#fff",
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
        lastBalance > 0 ? "#4ade80" : lastBalance < 0 ? "#f87171" : "#9ca3af";

    return (
        <div className="flex flex-col min-h-screen p-4 pb-24 space-y-6">
            {/* Header */}
            <header className="flex items-center gap-3 pt-2">
                <Link
                    href="/dashboard"
                    className="h-9 w-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4 text-white/70" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                        Análisis
                    </h1>
                    <p className="text-xs text-white/40">Últimos 6 meses</p>
                </div>
            </header>

            {/* Stat cards — 2x2 grid */}
            <section className="grid grid-cols-2 gap-3">
                <StatCard
                    label="Este mes"
                    value={`${stats.totalThisMonth.toFixed(2)}€`}
                    sub={`${stats.expensesThisMonthCount} gastos`}
                />
                <StatCard
                    label="Media mensual"
                    value={`${stats.avgMonthly.toFixed(2)}€`}
                    sub="últimos 6 meses"
                />
                <StatCard
                    label="Gastos este mes"
                    value={String(stats.expensesThisMonthCount)}
                />
                <StatCard
                    label="Categoría top"
                    value={stats.topCategory}
                />
            </section>

            {/* Monthly bar chart */}
            <section className={glassCard}>
                <h2 className="text-sm font-semibold text-white/70 mb-4">Gasto mensual</h2>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monthlySpending} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                            dataKey="month"
                            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                        <Legend
                            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}
                            formatter={(value) => value === "total" ? "Total pareja" : "Mi parte"}
                        />
                        <Bar dataKey="total" name="total" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="myShare" name="myShare" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </section>

            {/* Category pie chart */}
            {categoryBreakdown.length > 0 ? (
                <section className={glassCard}>
                    <h2 className="text-sm font-semibold text-white/70 mb-4">Por categoría (este mes)</h2>
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
                                            fill={CATEGORY_COLORS[item.category] ?? "#9ca3af"}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={chartTooltipStyle}
                                    formatter={(value) => [`${Number(value).toFixed(2)}€`, ""]}
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
                                            style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? "#9ca3af" }}
                                        />
                                        <span className="text-white/70">{item.label}</span>
                                    </span>
                                    <span className="font-mono text-white/80">{item.amount.toFixed(2)}€</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            ) : (
                <section className={`${glassCard} text-center py-8`}>
                    <p className="text-white/30 text-sm">Sin gastos este mes</p>
                </section>
            )}

            {/* Balance evolution line chart */}
            <section className={glassCard}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-white/70">Evolución del balance</h2>
                    <span
                        className="flex items-center gap-1 text-xs font-mono font-bold"
                        style={{ color: balanceColor }}
                    >
                        {lastBalance > 0 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                        ) : lastBalance < 0 ? (
                            <TrendingDown className="h-3.5 w-3.5" />
                        ) : (
                            <Minus className="h-3.5 w-3.5" />
                        )}
                        {lastBalance > 0 ? "+" : ""}
                        {lastBalance.toFixed(2)}€
                    </span>
                </div>
                {balanceEvolution.length > 1 ? (
                    <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={balanceEvolution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                contentStyle={chartTooltipStyle}
                                formatter={(value: number) => [`${value.toFixed(2)}€`, "Balance"]}
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
                    <p className="text-white/30 text-sm text-center py-8">Sin suficientes datos</p>
                )}
            </section>

            {/* Top 5 expenses */}
            <section className="space-y-3">
                <h2 className="text-sm font-semibold text-white/70 ml-1">Top gastos del mes</h2>
                {top5Expenses.length === 0 ? (
                    <div className={`${glassCard} text-center py-8`}>
                        <p className="text-white/30 text-sm">Sin gastos este mes</p>
                    </div>
                ) : (
                    top5Expenses.map((expense, idx) => (
                        <div
                            key={expense.id}
                            className="bg-white/5 border border-white/10 rounded-xl backdrop-blur-md p-4 flex items-center gap-3"
                        >
                            <span className="text-lg font-mono font-bold text-white/20 w-5 text-center flex-shrink-0">
                                {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{expense.description}</p>
                                <p className="text-[11px] text-white/40 mt-0.5">
                                    {expense.categoryLabel} · {expense.date}
                                </p>
                            </div>
                            <span className="text-base font-mono font-bold text-white flex-shrink-0">
                                {expense.amount.toFixed(2)}€
                            </span>
                        </div>
                    ))
                )}
            </section>

            {/* Top products from receipt breakdowns */}
            {topItems.length > 0 && (
                <section className={glassCard}>
                    <h2 className="text-sm font-semibold text-white/70 mb-1">Top productos (últimos 3 meses)</h2>
                    <p className="text-[11px] text-white/30 mb-4">Basado en los desgloses de tickets escaneados</p>
                    <div className="space-y-3">
                        {(() => {
                            const maxTotal = topItems[0]?.total ?? 1;
                            return topItems.map((item, idx) => (
                                <div key={item.name} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="text-white/20 font-mono w-4 flex-shrink-0">{idx + 1}</span>
                                            <span className="text-white/80 truncate font-medium">{item.name}</span>
                                        </span>
                                        <span className="font-mono font-bold text-white flex-shrink-0 ml-2">
                                            {item.total.toFixed(2)}€
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500"
                                                style={{ width: `${(item.total / maxTotal) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-white/30 flex-shrink-0 w-20 text-right">
                                            {item.count}× · {item.avgPrice.toFixed(2)}€/u
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
