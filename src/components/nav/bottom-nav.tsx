"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PiggyBank, BarChart2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
    { href: "/dashboard", label: "Inicio", icon: Home },
    { href: "/budget", label: "Presupuestos", icon: PiggyBank },
    { href: "/analytics", label: "Análisis", icon: BarChart2 },
    { href: "/settings", label: "Ajustes", icon: Settings },
] as const;

// The nav is a global surface but only the four top-level "tab" destinations
// should show it — focused full-screen flows (create, expense detail, settle,
// auth) stay chrome-free.
const TAB_ROUTES = TABS.map((t) => t.href);

export function BottomNav() {
    const pathname = usePathname();
    const isTabRoute = TAB_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
    if (!isTabRoute) return null;

    return (
        <nav
            aria-label="Navegación principal"
            className="fixed bottom-0 inset-x-0 z-40 sm:max-w-md sm:mx-auto border-t border-[color:var(--line)] bg-[var(--surface-hex)]/90 backdrop-blur-md"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
            <ul className="flex items-stretch justify-around h-16">
                {TABS.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                        <li key={href} className="flex-1">
                            <Link
                                href={href}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1 h-full text-[11px] font-medium transition-colors active:scale-95",
                                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Icon className={cn("h-5 w-5", active && "fill-primary/10")} />
                                {label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
