import React from "react";
import { cn } from "@/lib/utils";

/**
 * EQUIL layout for the chrome-free entry screens (login, registro, invitación,
 * crear cuenta de invitado, landing, 404/error). Mirrors the prototype's
 * `is.welcome`: green wordmark, 32–36px title, muted lead, content, and a footer
 * pinned to the bottom. The root layout already renders `<main>`, so this is a
 * plain div (no nested landmarks).
 */
export function AuthShell({
    title,
    subtitle,
    children,
    footer,
    className,
}: {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "min-h-dvh flex flex-col eq-in px-6 pt-12 pb-[calc(34px+env(safe-area-inset-bottom))]",
                className,
            )}
        >
            <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
            <h1 className="mt-3.5 text-[32px] font-bold tracking-[-0.03em] leading-[1.08] text-pretty break-words">
                {title}
            </h1>
            {subtitle && <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45] text-pretty">{subtitle}</p>}
            {children && <div className="pt-7 flex flex-col gap-3">{children}</div>}
            {footer && <div className="mt-auto pt-8 flex flex-col items-center gap-3 text-center">{footer}</div>}
        </div>
    );
}

/** Shared input styling for the entry screens (48px, 14px radius, hairline). */
export const AUTH_INPUT_CLASS =
    "h-12 w-full rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 placeholder:text-[color:var(--ink-3)]";

/** Labelled input (visible label → accessible name, IE-17). */
export function AuthField({
    label,
    hint,
    className,
    id,
    ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: React.ReactNode }) {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-xs font-semibold text-muted-foreground">
                {label}
            </label>
            <input id={inputId} aria-describedby={hintId} className={cn(AUTH_INPUT_CLASS, className)} {...props} />
            {hint && (
                <span id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                </span>
            )}
        </div>
    );
}

/** Inline error banner (announced to screen readers). */
export function AuthError({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            role="alert"
            className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm text-destructive text-pretty"
            {...props}
        >
            {children}
        </div>
    );
}

/** Small info note (e.g. "Al unirte, …"). */
export function AuthNote({ children, className }: { children: React.ReactNode; className?: string }) {
    return <p className={cn("text-xs leading-relaxed text-muted-foreground text-pretty", className)}>{children}</p>;
}
