"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
    className?: string;
    /** Icon-only (aria-labelled) instead of icon + "Cerrar sesión". */
    iconOnly?: boolean;
}

/** Ends the session (POST /api/auth/logout) and returns to /login. Unstyled row by default. */
export function LogoutButton({ className, iconOnly = false }: LogoutButtonProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleLogout = async () => {
        setLoading(true);
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
        } catch (error) {
            console.error("Logout failed", error);
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            aria-label={iconOnly ? "Cerrar sesión" : undefined}
            className={cn("flex items-center gap-3 text-left disabled:opacity-50", className)}
        >
            <LogOut className="h-[19px] w-[19px] flex-none" />
            {!iconOnly && <span className="flex-1 text-[15px]">Cerrar sesión</span>}
        </button>
    );
}
