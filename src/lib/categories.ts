import { LucideIcon } from "lucide-react";
import { getIconComponent } from "./category-icons";

export interface Category {
    id: string;
    emoji: string;
    label: string;
    labelEn: string;
    color: string;
    bgColor: string;
    /** Solid hex used by the minimalist spending-breakdown bar (EQUIL - Flujo de Gastos redesign). */
    hex: string;
    /**
     * Lucide component derived from `iconName` via ICON_REGISTRY (single source
     * of the string→component mapping — see src/lib/category-icons.ts).
     */
    icon: LucideIcon;
    /** Lucide component name persisted in the DB (`Category.icon`). */
    iconName: string;
}

/**
 * System-category metadata seed. `iconName` is the lucide component NAME (as
 * stored in the DB); the rendered `icon` component is derived from
 * ICON_REGISTRY below so the name→component mapping lives in exactly one place.
 * Keep in sync with prisma/seed.ts and scripts/seed-categories-and-backfill.ts.
 */
const SYSTEM_CATEGORY_META: Record<string, Omit<Category, "icon">> = {
    shopping: {
        id: "shopping",
        emoji: "🛍️",
        label: "Compras",
        labelEn: "shopping",
        color: "text-pink-400",
        bgColor: "bg-pink-400/20",
        hex: "#f472b6",
        iconName: "ShoppingBag",
    },
    food: {
        id: "food",
        emoji: "🍕",
        label: "Comida",
        labelEn: "food",
        color: "text-orange-400",
        bgColor: "bg-orange-400/20",
        hex: "#fb923c",
        iconName: "Coffee",
    },
    rent: {
        id: "rent",
        emoji: "🏠",
        label: "Alquiler",
        labelEn: "rent",
        color: "text-blue-400",
        bgColor: "bg-blue-400/20",
        hex: "#60a5fa",
        iconName: "Home",
    },
    utilities: {
        id: "utilities",
        emoji: "💡",
        label: "Recibos",
        labelEn: "utilities",
        color: "text-yellow-400",
        bgColor: "bg-yellow-400/20",
        hex: "#facc15",
        iconName: "Lightbulb",
    },
    transport: {
        id: "transport",
        emoji: "🚗",
        label: "Transporte",
        labelEn: "transport",
        color: "text-green-400",
        bgColor: "bg-green-400/20",
        hex: "#4ade80",
        iconName: "TramFront",
    },
    entertainment: {
        id: "entertainment",
        emoji: "🎬",
        label: "Ocio",
        labelEn: "entertainment",
        color: "text-purple-400",
        bgColor: "bg-purple-400/20",
        hex: "#c084fc",
        iconName: "Clapperboard",
    },
    health: {
        id: "health",
        emoji: "💊",
        label: "Salud",
        labelEn: "health",
        color: "text-red-400",
        bgColor: "bg-red-400/20",
        hex: "#f87171",
        iconName: "Heart",
    },
    other: {
        id: "other",
        emoji: "📦",
        label: "Otro",
        labelEn: "other",
        color: "text-gray-400",
        bgColor: "bg-gray-400/20",
        hex: "#9ca3af",
        iconName: "Receipt",
    },
};

export const CATEGORIES: Record<string, Category> = Object.fromEntries(
    Object.entries(SYSTEM_CATEGORY_META).map(([key, meta]) => [
        key,
        { ...meta, icon: getIconComponent(meta.iconName) },
    ]),
);

// Helper functions
export const getCategoryById = (id: string): Category => {
    return CATEGORIES[id] || CATEGORIES.other;
};

export const getAllCategories = (): Category[] => {
    return Object.values(CATEGORIES);
};
