"use client";

// EQUIL design primitives (rediseño "EQUIL Prototipo"). Shared by every screen
// so spacing/radii/colours stay consistent; screen-specific layout lives in
// each page. Colours come from the tokens in globals.css — never hardcode hex.

import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";

/** White rounded card with a soft hairline (18px radius). */
export function EqCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("bg-card rounded-[18px] border border-[color:var(--line-2)]", className)}
            {...props}
        />
    );
}

/** Small muted section label ("Recientes", "Por categoría"…). */
export function EqLabel({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
    return <span className={cn("text-xs font-semibold text-muted-foreground", className)} {...props} />;
}

/**
 * Screen header. `back` renders an arrow (href or onClick) before the title;
 * `meta` is the right-aligned context (usually the active space "🏠 Casa").
 */
export function EqHeader({
    title,
    meta,
    back,
    onBack,
    close,
    className,
    children,
}: {
    title?: React.ReactNode;
    meta?: React.ReactNode;
    back?: string;
    onBack?: () => void;
    close?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    const Icon = close ? X : ArrowLeft;
    const backEl = back ? (
        <Link href={back} aria-label={close ? "Cerrar" : "Volver"} className="h-6 w-6 flex-none">
            <Icon className="h-6 w-6" />
        </Link>
    ) : onBack ? (
        <button type="button" onClick={onBack} aria-label={close ? "Cerrar" : "Volver"} className="h-6 w-6 flex-none">
            <Icon className="h-6 w-6" />
        </button>
    ) : null;
    return (
        <header className={cn("px-5 pt-1 flex items-center gap-2.5", className)}>
            {backEl}
            {title !== undefined && (
                <h1 className="text-2xl font-bold tracking-[-0.02em] flex-1 min-w-0 truncate">{title}</h1>
            )}
            {children}
            {/* The meta (often a space name) truncates and is capped so it never squeezes the title to 0. */}
            {meta !== undefined && <span className="text-[13px] text-muted-foreground min-w-0 max-w-[55%] truncate">{meta}</span>}
        </header>
    );
}

/** Pill chip. `tone="ink"` = filter chips (black when selected), `"accent"` = green selection, `"add"` = dashed. */
export function EqChip({
    selected,
    tone = "ink",
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; tone?: "ink" | "accent" | "add" }) {
    return (
        <button
            type="button"
            aria-pressed={tone === "add" ? undefined : !!selected}
            className={cn(
                "flex-none whitespace-nowrap rounded-full px-3 py-[7px] text-[13px] font-semibold border transition-colors",
                tone === "add" && "border-dashed border-[color:var(--line-strong)] hover:bg-card",
                tone === "ink" && (selected ? "bg-foreground text-white border-foreground" : "bg-card text-foreground border-[color:var(--line)]"),
                tone === "accent" && (selected ? "bg-primary text-white border-primary" : "bg-card text-foreground border-[color:var(--line)]"),
                className
            )}
            {...props}
        />
    );
}

/** Two-or-more option segmented control (Presupuestos | Análisis). */
export function EqSegmented<T extends string>({
    value,
    options,
    onChange,
    className,
}: {
    value: T;
    options: { value: T; label: React.ReactNode }[];
    onChange: (v: T) => void;
    className?: string;
}) {
    return (
        <div
            role="tablist"
            tabIndex={-1}
            className={cn("flex rounded-xl bg-[var(--track)] p-[3px] text-sm font-semibold", className)}
            onKeyDown={(e) => {
                // WAI-ARIA tabs: arrows move the selection, Home/End jump to the ends.
                const i = options.findIndex((o) => o.value === value);
                const next =
                    e.key === "ArrowRight" ? (i + 1) % options.length
                    : e.key === "ArrowLeft" ? (i - 1 + options.length) % options.length
                    : e.key === "Home" ? 0
                    : e.key === "End" ? options.length - 1
                    : -1;
                if (next < 0) return;
                e.preventDefault();
                onChange(options[next].value);
                const tabs = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs[next]?.focus();
            }}
        >
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            "flex-1 rounded-[10px] py-2 text-center transition-colors",
                            active ? "bg-card text-foreground" : "text-muted-foreground"
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Big 56px call-to-action. `variant="ink"` = black (secondary flows), `"outline"` = white. */
export const EqCta = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ink" | "outline" }
>(({ variant = "primary", className, ...props }, ref) => (
    <button
        ref={ref}
        type="button"
        className={cn(
            "w-full h-14 rounded-[18px] text-base font-semibold flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100",
            variant === "primary" && "bg-primary text-primary-foreground",
            variant === "ink" && "bg-foreground text-white",
            variant === "outline" && "bg-card border border-[color:var(--line)] text-foreground",
            className
        )}
        {...props}
    />
));
EqCta.displayName = "EqCta";

/**
 * Expense / settlement row: 40px icon tile, title + subtitle, amount on the
 * right. Used by Inicio (Recientes) and Gastos.
 */
export function EqRow({
    icon,
    iconTint,
    title,
    sub,
    amount,
    amountClassName,
    href,
    onClick,
}: {
    icon: React.ReactNode;
    iconTint?: boolean;
    title: React.ReactNode;
    sub?: React.ReactNode;
    amount: React.ReactNode;
    amountClassName?: string;
    href?: string;
    onClick?: () => void;
}) {
    const inner = (
        <>
            <span
                className={cn(
                    "h-10 w-10 flex-none rounded-xl border border-[color:var(--line-2)] flex items-center justify-center text-lg text-primary",
                    iconTint ? "bg-[var(--accent-tint)]" : "bg-card"
                )}
            >
                {icon}
            </span>
            <div className="flex-1 min-w-0 text-left">
                <div className="text-[15px] font-semibold truncate">{title}</div>
                {sub && <div className="text-[12.5px] text-muted-foreground truncate">{sub}</div>}
            </div>
            <span className={cn("text-[15px] font-semibold tabular-nums", amountClassName)}>{amount}</span>
        </>
    );
    const cls = "flex items-center gap-3 py-2.5 w-full";
    if (href) return <Link href={href} className={cls}>{inner}</Link>;
    if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
    return <div className={cls}>{inner}</div>;
}

/** Ephemeral bottom toast (dark pill above the nav). Render conditionally. */
export function EqToast({ children }: { children: React.ReactNode }) {
    return (
        <output
            className="eq-in fixed left-1/2 bottom-[104px] -translate-x-1/2 z-50 whitespace-nowrap rounded-[14px] bg-foreground px-4 py-[11px] text-sm font-medium text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.4)]"
        >
            {children}
        </output>
    );
}

/** Hook: `const [toast, show] = useEqToast()` → `{toast && <EqToast>{toast}</EqToast>}`. */
export function useEqToast(ms = 2000): [string | null, (m: string) => void] {
    const [msg, setMsg] = React.useState<string | null>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const show = React.useCallback((m: string) => {
        if (timer.current) clearTimeout(timer.current);
        setMsg(m);
        timer.current = setTimeout(() => setMsg(null), ms);
    }, [ms]);
    return [msg, show];
}
