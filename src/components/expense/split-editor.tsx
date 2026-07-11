"use client";

import { cn } from "@/lib/utils";
import { formatEuros, parseAmountInput, formatAmountInput } from "@/lib/currency";
import { Scale, SlidersHorizontal, Percent, UserRound } from "lucide-react";

/**
 * SplitEditor — the single N-way split editor (Fase 1). Reused by expense
 * creation and edition, it replaces the old `isTwoMember` / `splitWithPartner`
 * branching entirely. It is a fully-controlled component: the parent owns a
 * {@link SplitValue} and derives the API payload with {@link computeSplit} on
 * submit.
 *
 * Modes:
 *  - "equal"     → EQUAL strategy (no customSplits; the API divides evenly).
 *  - "amounts"   → CUSTOM strategy with explicit per-member euro amounts.
 *  - "percent"   → CUSTOM strategy from per-member percentages (→ cents).
 *  - "exclusive" → EXCLUSIVE strategy: 100% charged to one beneficiary
 *                  ("favor para X").
 *
 * All amounts are handled in CENTS internally; euros are only for the inputs.
 */

export type SplitMode = "equal" | "amounts" | "percent" | "exclusive";

export type SplitMember = { id: string; name: string; avatar?: string | null };

export type SplitValue = {
    mode: SplitMode;
    /** Per-member euro strings (es-ES comma decimals ok), used by "amounts". */
    amounts: Record<string, string>;
    /** Per-member integer percentages, used by "percent". */
    percents: Record<string, number>;
    /** Beneficiary (charged 100%) for "exclusive". */
    beneficiaryId: string | null;
};

export type SplitResult = {
    valid: boolean;
    /** Reason the current value is invalid (for inline UX). */
    reason?: string;
    strategy: "EQUAL" | "CUSTOM" | "EXCLUSIVE";
    /** Per-member cents; sums to totalCents when valid. */
    shares: Record<string, number>;
    /** Ready-to-send customSplits (undefined for EQUAL). */
    customSplits?: { userId: string; amount: number }[];
    /** Beneficiary id for EXCLUSIVE (undefined otherwise). */
    beneficiaryId?: string;
};

/** Even split with the largest-remainder leftover cent going to the FIRST members. */
function equalShares(members: SplitMember[], totalCents: number): Record<string, number> {
    const out: Record<string, number> = {};
    if (members.length === 0) return out;
    const base = Math.floor(totalCents / members.length);
    let remainder = totalCents - base * members.length;
    for (const m of members) {
        out[m.id] = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
    }
    return out;
}

/** Turn a set of integer percentages into cents that sum to exactly totalCents. */
function percentShares(
    members: SplitMember[],
    percents: Record<string, number>,
    totalCents: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    let allocated = 0;
    for (const m of members) {
        const p = percents[m.id] ?? 0;
        const cents = Math.floor((totalCents * p) / 100);
        out[m.id] = cents;
        allocated += cents;
    }
    // Push the rounding leftover onto the largest-percentage member so the sum is exact.
    let leftover = totalCents - allocated;
    const order = [...members].sort((a, b) => (percents[b.id] ?? 0) - (percents[a.id] ?? 0));
    let i = 0;
    while (leftover > 0 && order.length > 0) {
        out[order[i % order.length].id] += 1;
        leftover--;
        i++;
    }
    return out;
}

/**
 * Pure derivation of the API payload from a SplitValue. Exported so the parent
 * can compute the body on submit without duplicating the split math.
 */
export function computeSplit(
    value: SplitValue,
    members: SplitMember[],
    totalCents: number,
): SplitResult {
    if (value.mode === "equal") {
        return { valid: true, strategy: "EQUAL", shares: equalShares(members, totalCents) };
    }

    if (value.mode === "exclusive") {
        const id = value.beneficiaryId;
        if (!id || !members.some((m) => m.id === id)) {
            return { valid: false, reason: "Elige a quién se le carga el gasto", strategy: "EXCLUSIVE", shares: {} };
        }
        const shares: Record<string, number> = {};
        for (const m of members) shares[m.id] = m.id === id ? totalCents : 0;
        return {
            valid: true,
            strategy: "EXCLUSIVE",
            shares,
            beneficiaryId: id,
            // Also expressible as customSplits (edit path has no beneficiaryId param).
            customSplits: [{ userId: id, amount: totalCents }],
        };
    }

    if (value.mode === "percent") {
        const sum = members.reduce((acc, m) => acc + (value.percents[m.id] ?? 0), 0);
        if (sum !== 100) {
            return { valid: false, reason: "Los porcentajes deben sumar 100%", strategy: "CUSTOM", shares: {} };
        }
        const shares = percentShares(members, value.percents, totalCents);
        return {
            valid: true,
            strategy: "CUSTOM",
            shares,
            customSplits: members.map((m) => ({ userId: m.id, amount: shares[m.id] })),
        };
    }

    // "amounts"
    const shares: Record<string, number> = {};
    let sum = 0;
    for (const m of members) {
        const cents = Math.round(parseAmountInput(value.amounts[m.id] || "") * 100) || 0;
        shares[m.id] = cents;
        sum += cents;
    }
    if (sum !== totalCents) {
        const diff = totalCents - sum;
        return {
            valid: false,
            reason: diff > 0 ? `Faltan ${formatEuros(diff / 100)}` : `Te pasas ${formatEuros(Math.abs(diff) / 100)}`,
            strategy: "CUSTOM",
            shares,
        };
    }
    return {
        valid: true,
        strategy: "CUSTOM",
        shares,
        customSplits: members.map((m) => ({ userId: m.id, amount: shares[m.id] })),
    };
}

/**
 * Seed a fresh SplitValue for a given mode, pre-filling per-member amounts /
 * percents from an even baseline so the user only nudges deltas. Used when the
 * mode changes and to build the initial value for creation.
 */
export function seedSplitValue(
    mode: SplitMode,
    members: SplitMember[],
    totalCents: number,
    beneficiaryId: string | null = null,
): SplitValue {
    const amounts: Record<string, string> = {};
    const percents: Record<string, number> = {};
    const eq = equalShares(members, totalCents);
    const n = members.length || 1;
    const basePct = Math.floor(100 / n);
    let pctRemainder = 100 - basePct * n;
    for (const m of members) {
        amounts[m.id] = formatAmountInput((eq[m.id] ?? 0) / 100);
        percents[m.id] = basePct + (pctRemainder > 0 ? 1 : 0);
        if (pctRemainder > 0) pctRemainder--;
    }
    return { mode, amounts, percents, beneficiaryId };
}

/**
 * Build the initial SplitValue when editing an existing expense, hydrating from
 * the persisted strategy + materialized split rows (both in cents).
 */
export function splitValueFromExisting(
    strategy: "EQUAL" | "CUSTOM" | "EXCLUSIVE" | "ITEMIZED" | null | undefined,
    existingSplits: { userId: string; amount: number }[],
    members: SplitMember[],
    totalCents: number,
): SplitValue {
    if (strategy === "EXCLUSIVE") {
        const only = existingSplits.length === 1 ? existingSplits[0].userId : null;
        return seedSplitValue("exclusive", members, totalCents, only);
    }
    if (strategy === "CUSTOM") {
        const seeded = seedSplitValue("amounts", members, totalCents);
        const byId = new Map(existingSplits.map((s) => [s.userId, s.amount]));
        for (const m of members) {
            const cents = byId.get(m.id) ?? 0;
            seeded.amounts[m.id] = formatAmountInput(cents / 100);
        }
        return seeded;
    }
    // EQUAL / ITEMIZED / null all start on the equal preset.
    return seedSplitValue("equal", members, totalCents);
}

const MODES: { key: SplitMode; label: string; icon: typeof Scale }[] = [
    { key: "equal", label: "A partes iguales", icon: Scale },
    { key: "amounts", label: "Importes", icon: SlidersHorizontal },
    { key: "percent", label: "Porcentajes", icon: Percent },
    { key: "exclusive", label: "Favor para alguien", icon: UserRound },
];

export function SplitEditor({
    members,
    currentUserId,
    totalCents,
    value,
    onChange,
    isCouple = false,
    className,
}: {
    members: SplitMember[];
    currentUserId: string;
    totalCents: number;
    value: SplitValue;
    onChange: (v: SplitValue) => void;
    /** COUPLE spaces highlight the "Mitad y mitad" preset. */
    isCouple?: boolean;
    className?: string;
}) {
    const result = computeSplit(value, members, totalCents);
    const nameOf = (m: SplitMember) => (m.id === currentUserId ? "Yo" : m.name);

    const setMode = (mode: SplitMode) => {
        // Re-seed the per-member inputs from an even baseline on every mode switch
        // so the user starts from a valid distribution.
        onChange(seedSplitValue(mode, members, totalCents, value.beneficiaryId));
    };

    return (
        <fieldset className={cn("space-y-3 border-0 p-0 m-0", className)}>
            <legend className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground p-0">
                ¿Cómo se divide?
            </legend>

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-2">
                {MODES.map(({ key, label, icon: Icon }) => {
                    const sel = value.mode === key;
                    const highlight = isCouple && key === "equal";
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setMode(key)}
                            aria-pressed={sel}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98]",
                                sel
                                    ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)] text-foreground"
                                    : "bg-card border-[color:var(--line)] text-muted-foreground hover:bg-secondary",
                            )}
                        >
                            <Icon className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate text-left">
                                {highlight && key === "equal" ? "Mitad y mitad" : label}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Equal preview */}
            {value.mode === "equal" && (
                <div className="rounded-xl bg-secondary p-4 space-y-1.5 animate-in fade-in duration-200">
                    {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground truncate">{nameOf(m)}</span>
                            <span className="font-mono font-semibold text-foreground">
                                {formatEuros((result.shares[m.id] ?? 0) / 100)}
                            </span>
                        </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground/70 pt-1">
                        Entre {members.length} {members.length === 1 ? "persona" : "personas"}.
                    </p>
                </div>
            )}

            {/* Per-member amounts */}
            {value.mode === "amounts" && (
                <div className="rounded-xl bg-secondary p-4 space-y-2 animate-in fade-in duration-200">
                    {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-3">
                            <label htmlFor={`split-amount-${m.id}`} className="text-sm text-muted-foreground truncate">
                                {nameOf(m)}
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    id={`split-amount-${m.id}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={value.amounts[m.id] ?? ""}
                                    onChange={(e) =>
                                        onChange({ ...value, amounts: { ...value.amounts, [m.id]: e.target.value } })
                                    }
                                    placeholder="0,00"
                                    className="w-24 bg-card border border-[color:var(--line)] rounded-lg px-2 py-1.5 text-sm font-bold text-right focus:outline-none focus:border-[color:var(--accent-border)]"
                                />
                                <span className="text-sm text-muted-foreground">€</span>
                            </div>
                        </div>
                    ))}
                    <div
                        className={cn(
                            "text-xs text-center pt-1 border-t border-[color:var(--line)] mt-1",
                            result.valid ? "text-[color:var(--positive)]" : "text-destructive",
                        )}
                    >
                        {result.valid ? "Cuadra con el total ✓" : result.reason}
                    </div>
                </div>
            )}

            {/* Per-member percentages */}
            {value.mode === "percent" && (
                <div className="rounded-xl bg-secondary p-4 space-y-2 animate-in fade-in duration-200">
                    {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-3">
                            <label htmlFor={`split-pct-${m.id}`} className="text-sm text-muted-foreground truncate">
                                {nameOf(m)}
                            </label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    id={`split-pct-${m.id}`}
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={100}
                                    value={value.percents[m.id] ?? 0}
                                    onChange={(e) =>
                                        onChange({
                                            ...value,
                                            percents: {
                                                ...value.percents,
                                                [m.id]: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                                            },
                                        })
                                    }
                                    className="w-16 bg-card border border-[color:var(--line)] rounded-lg px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-[color:var(--accent-border)]"
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                                <span className="w-16 text-right text-xs font-mono text-muted-foreground">
                                    {formatEuros((result.shares[m.id] ?? 0) / 100)}
                                </span>
                            </div>
                        </div>
                    ))}
                    <div
                        className={cn(
                            "text-xs text-center pt-1 border-t border-[color:var(--line)] mt-1",
                            result.valid ? "text-[color:var(--positive)]" : "text-destructive",
                        )}
                    >
                        {result.valid ? "Suma 100% ✓" : result.reason}
                    </div>
                </div>
            )}

            {/* Exclusive beneficiary */}
            {value.mode === "exclusive" && (
                <div className="rounded-xl bg-secondary p-4 space-y-2 animate-in fade-in duration-200">
                    <p className="text-[11px] text-muted-foreground/80">
                        Se carga el 100% a una persona (un favor). El resto no paga nada.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {members.map((m) => {
                            const sel = value.beneficiaryId === m.id;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => onChange({ ...value, beneficiaryId: m.id })}
                                    aria-pressed={sel}
                                    className={cn(
                                        "px-3 py-2 rounded-xl text-sm font-semibold border transition-all active:scale-[0.98]",
                                        sel
                                            ? "bg-primary text-white border-primary shadow"
                                            : "bg-card border-[color:var(--line)] text-muted-foreground hover:bg-secondary",
                                    )}
                                >
                                    {nameOf(m)}
                                </button>
                            );
                        })}
                    </div>
                    {!result.valid && <p className="text-xs text-destructive">{result.reason}</p>}
                </div>
            )}
        </fieldset>
    );
}
