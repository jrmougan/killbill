"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, List, Plus, CalendarRange, ShoppingBasket, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: typeof House };

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
    { href: "/guest/upgrade", label: "Crear cuenta", icon: UserPlus },
];

const ADD_HREF = "/expenses/new";

// The nav is a global surface but only the top-level "tab" destinations show
// it — focused full-screen flows (add, expense detail, settle, auth) stay
// chrome-free. Shopping-list detail keeps the nav (it is still the Listas tab).
const TAB_ROUTES = TABS.map((t) => t.href);

function isActive(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

function NavTab({ tab, active }: { tab: Tab; active: boolean }) {
    const Icon = tab.icon;
    return (
        <li className="w-14 flex justify-center">
            <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "flex flex-col items-center gap-1 pt-2.5 text-[10.5px] font-medium transition-colors active:scale-95",
                    active ? "text-foreground" : "text-[color:#8A8C85] hover:text-foreground"
                )}
            >
                <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
                {tab.label}
            </Link>
        </li>
    );
}

export function BottomNav({ isGuest = false }: { isGuest?: boolean }) {
    const pathname = usePathname();
    const isTabRoute = TAB_ROUTES.some((r) => isActive(pathname, r));
    if (!isTabRoute) return null;

    const tabs = isGuest ? GUEST_TABS : TABS;
    const mid = Math.ceil(tabs.length / 2);

    return (
        <nav
            aria-label="Navegación principal"
            className="fixed bottom-0 inset-x-0 z-40 sm:max-w-md sm:mx-auto border-t border-[color:var(--line-2)] bg-white/95 backdrop-blur-md"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
            <ul className="flex items-start justify-around h-[74px]">
                {tabs.slice(0, mid).map((t) => (
                    <NavTab key={t.href} tab={t} active={isActive(pathname, t.href)} />
                ))}
                <li className="flex justify-center">
                    <Link
                        href={ADD_HREF}
                        aria-label="Añadir gasto"
                        className="-mt-3.5 flex h-[54px] w-[54px] items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_10px_20px_-8px_rgba(47,125,91,0.7)] transition-transform active:scale-[0.94]"
                    >
                        <Plus className="h-[26px] w-[26px]" strokeWidth={2} />
                    </Link>
                </li>
                {tabs.slice(mid).map((t) => (
                    <NavTab key={t.href} tab={t} active={isActive(pathname, t.href)} />
                ))}
            </ul>
        </nav>
    );
}
