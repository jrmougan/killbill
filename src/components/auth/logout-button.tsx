"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
    className?: string;
    /** Icon-only (aria-labelled) instead of icon + "Cerrar sesión". */
    iconOnly?: boolean;
}

/**
 * Ends the session (POST /api/auth/logout) and hard-navigates to
 * /login?signedOut=1. A failed request keeps the user here with an error
 * instead of pretending the session is closed. Unstyled row by default.
 */
export function LogoutButton({ className, iconOnly = false }: LogoutButtonProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogout = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/auth/logout", { method: "POST" });
            if (!res.ok) throw new Error(`logout ${res.status}`);
            // Full navigation: drops every cached RSC payload of the old session.
            window.location.assign("/login?signedOut=1");
        } catch {
            setError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
            setLoading(false);
        }
    };

    const label = loading ? "Cerrando sesión…" : "Cerrar sesión";
    return (
        <div>
            <button
                type="button"
                onClick={handleLogout}
                disabled={loading}
                aria-busy={loading || undefined}
                aria-label={iconOnly ? label : undefined}
                className={cn("flex items-center gap-3 text-left disabled:opacity-50", className)}
            >
                <LogOut className="h-[19px] w-[19px] flex-none" />
                {!iconOnly && <span className="flex-1 text-[15px]">{label}</span>}
            </button>
            {error && (
                <p role="alert" className="pb-3 text-sm text-[color:var(--negative-ink)]">
                    {error}
                </p>
            )}
        </div>
    );
}
