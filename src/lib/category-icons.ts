/**
 * Category icon registry — the single string→component resolver for lucide icons
 * used by categories.
 *
 * Why this exists: `Category.icon` is persisted in the DB as a lucide component
 * NAME (a string, e.g. "ShoppingBag"), but the UI needs an actual React
 * component to render. There was no resolver in the repo, so `src/lib/categories.ts`
 * duplicated the component reference by hand. This module is the only place that
 * maps names → components, so:
 *   - the icon picker offers exactly `ICON_KEYS`;
 *   - render does `getIconComponent(name)` (safe fallback, never crashes);
 *   - the server validates `name ∈ ICON_KEYS` (400 otherwise).
 *
 * Icons are imported STATICALLY (named imports) to preserve tree-shaking — do NOT
 * switch to a dynamic `lucide-react` lookup.
 *
 * INVARIANT: the 8 system-category icon names (ShoppingBag, Coffee, Home,
 * Lightbulb, TramFront, Clapperboard, Heart, Receipt — see src/lib/categories.ts
 * and prisma/seed.ts) MUST be present here, or the DB-driven render of the system
 * categories themselves breaks. Guarded by category-icons.test.ts.
 */
import {
    // System-category icons (the 8 — keep in sync with categories.ts / seed.ts)
    ShoppingBag,
    Coffee,
    Home,
    Lightbulb,
    TramFront,
    Clapperboard,
    Heart,
    Receipt,
    // Shopping / general
    ShoppingCart,
    Gift,
    Package,
    Shirt,
    // Food & drink
    Utensils,
    Pizza,
    Wine,
    // Home & utilities
    Zap,
    Wifi,
    Droplet,
    Flame,
    Wrench,
    // Transport
    Car,
    Bus,
    Plane,
    Fuel,
    Bike,
    // Entertainment
    Film,
    Music,
    Gamepad2,
    Tv,
    Ticket,
    // Health
    HeartPulse,
    Pill,
    Stethoscope,
    Dumbbell,
    // Money / misc
    CreditCard,
    Coins,
    PiggyBank,
    Briefcase,
    GraduationCap,
    MoreHorizontal,
    type LucideIcon,
} from "lucide-react";

/**
 * Curated registry of ~40 lucide icons available for categories. The KEY is the
 * lucide component name (exactly as stored in `Category.icon`).
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
    // --- System-category icons (must all be present) ---
    ShoppingBag,
    Coffee,
    Home,
    Lightbulb,
    TramFront,
    Clapperboard,
    Heart,
    Receipt,
    // --- Shopping / general ---
    ShoppingCart,
    Gift,
    Package,
    Shirt,
    // --- Food & drink ---
    Utensils,
    Pizza,
    Wine,
    // --- Home & utilities ---
    Zap,
    Wifi,
    Droplet,
    Flame,
    Wrench,
    // --- Transport ---
    Car,
    Bus,
    Plane,
    Fuel,
    Bike,
    // --- Entertainment ---
    Film,
    Music,
    Gamepad2,
    Tv,
    Ticket,
    // --- Health ---
    HeartPulse,
    Pill,
    Stethoscope,
    Dumbbell,
    // --- Money / misc ---
    CreditCard,
    Coins,
    PiggyBank,
    Briefcase,
    GraduationCap,
    MoreHorizontal,
};

/** Safe fallback used when an icon name isn't in the registry. */
export const FALLBACK_ICON: LucideIcon = MoreHorizontal;

/** Ordered list of icon names for the picker and server-side validation. */
export const ICON_KEYS: string[] = Object.keys(ICON_REGISTRY);

/** Resolve a lucide component from its stored name, with a safe fallback. */
export function getIconComponent(name: string | null | undefined): LucideIcon {
    if (!name) return FALLBACK_ICON;
    return ICON_REGISTRY[name] ?? FALLBACK_ICON;
}

/** Whether a name is a valid, registered icon key (for server validation). */
export function isValidIconName(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(ICON_REGISTRY, name);
}
