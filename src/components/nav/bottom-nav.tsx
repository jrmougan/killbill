"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { House, List, Plus, CalendarRange, ShoppingBasket, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: typeof House; ariaLabel?: string };

// EQUIL nav: four tabs around a central "add expense" action. Ajustes and
// Espacios are reached from the dashboard header (avatar / "Ver espacios").
const TABS: Tab[] = [
    { href: "/dashboard", label: "Inicio", icon: House },
    { href: "/expenses/list", label: "Gastos", icon: List },
    { href: "/month", label: "Mes", icon: CalendarRange },
    { href: "/lists", label: "Listas", icon: ShoppingBasket },
];

// A GUEST session (Fase 3) may only reach dashboard/expenses/settle (the proxy
// vetoes /month, /lists, /settings). So it gets a reduced nav: its space home,
// the expense list, and a one-tap route to claim a real account.
const GUEST_TABS: Tab[] = [
    { href: "/dashboard", label: "Inicio", icon: House },
    { href: "/expenses/list", label: "Gastos", icon: List },
    { href: "/guest/upgrade", label: "Cuenta", ariaLabel: "Crear cuenta", icon: UserPlus },
];

const ADD_HREF = "/expenses/new";

// The nav is a global surface but only the top-level "tab" destinations show
// it — focused full-screen flows (add, expense detail, settle, auth) stay
// chrome-free. Shopping-list detail keeps the nav (it is still the Listas tab).
const TAB_ROUTES = TABS.map((t) => t.href);

// Personal mode lives in the URL (`?scope=personal`), not in a cookie. Carry it
// across the tabs that understand it so switching tabs doesn't silently jump
// back to the shared space. Tabs that don't take the param (Listas) keep the
// last known mode in sessionStorage so leaving them restores it.
const SCOPE_KEY = "eq-scope-personal";
const SCOPED_ROUTES = new Set(["/dashboard", "/expenses/list", "/month", "/expenses/new"]);

function withScope(href: string, personal: boolean) {
    if (!personal || !SCOPED_ROUTES.has(href)) return href;
    return href === "/expenses/new" ? `${href}?space=personal` : `${href}?scope=personal`;
}

function isActive(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

function NavTab({ tab, active, personal }: { tab: Tab; active: boolean; personal: boolean }) {
    const Icon = tab.icon;
    return (
        <li className="w-14 flex justify-center">
            <Link
                href={withScope(tab.href, personal)}
                aria-current={active ? "page" : undefined}
                aria-label={tab.ariaLabel}
                className={cn(
                    "flex flex-col items-center gap-1 pt-2.5 text-[10.5px] font-medium transition-colors active:scale-95",
                    active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                )}
            >
                <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
                {tab.label}
            </Link>
        </li>
    );
}

/**
 * Record the Común/Personal mode of a scoped route in sessionStorage and return
 * the effective mode for the nav (URL on scoped routes, else the remembered one).
 */
function useScopeMemory(): { pathname: string; personal: boolean } {
    const pathname = usePathname();
    const scopeParam = useSearchParams().get("scope");
    const scopedRoute = [...SCOPED_ROUTES].some((r) => isActive(pathname, r));
    const [remembered, setRemembered] = useState(false);
    useEffect(() => {
        try {
            if (scopedRoute) sessionStorage.setItem(SCOPE_KEY, scopeParam === "personal" ? "1" : "0");
            // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
            setRemembered(sessionStorage.getItem(SCOPE_KEY) === "1");
        } catch { /* storage unavailable: URL param only */ }
    }, [scopedRoute, scopeParam]);
    return { pathname, personal: scopedRoute ? scopeParam === "personal" : remembered };
}

/**
 * Global, render-less scope recorder (root layout). The nav itself is only
 * mounted on the tab routes, but the mode must also be remembered on every
 * scoped route (e.g. /expenses/new) and as soon as the app shell hydrates, so
 * Ajustes → Categorías / Presupuestos keep it (see settings/personal-mode.ts).
 */
export function ScopeMemory() {
    useScopeMemory();
    return null;
}

export function BottomNav({ isGuest = false }: { isGuest?: boolean }) {
    const { pathname, personal } = useScopeMemory();
    const isTabRoute = TAB_ROUTES.some((r) => isActive(pathname, r));
    if (!isTabRoute) return null;

    const tabs = isGuest ? GUEST_TABS : TABS;
    const mid = Math.ceil(tabs.length / 2);
    // Keep the FAB centred when the tab count is odd (guest nav).
    const spacer = tabs.length % 2 === 1;

    return (
        <nav
            aria-label="Navegación principal"
            className="fixed bottom-0 inset-x-0 z-40 sm:max-w-md sm:mx-auto border-t border-[color:var(--line-2)] bg-white/95 backdrop-blur-md"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
            <ul className="flex items-start justify-around h-[74px]">
                {tabs.slice(0, mid).map((t) => (
                    <NavTab key={t.href} tab={t} active={isActive(pathname, t.href)} personal={personal} />
                ))}
                <li className="flex justify-center">
                    <Link
                        href={withScope(ADD_HREF, personal)}
                        aria-label="Añadir gasto"
                        className="-mt-3.5 flex h-[54px] w-[54px] items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_10px_20px_-8px_rgba(47,125,91,0.7)] transition-transform active:scale-[0.94]"
                    >
                        <Plus className="h-[26px] w-[26px]" strokeWidth={2} />
                    </Link>
                </li>
                {tabs.slice(mid).map((t) => (
                    <NavTab key={t.href} tab={t} active={isActive(pathname, t.href)} personal={personal} />
                ))}
                {spacer && <li className="w-14" aria-hidden />}
            </ul>
        </nav>
    );
}
