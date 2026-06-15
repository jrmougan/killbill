import { Coffee, Home, Lightbulb, TramFront, ShoppingBag, Receipt, Heart, Clapperboard } from "lucide-react";
import { LucideIcon } from "lucide-react";

export interface Category {
    id: string;
    emoji: string;
    label: string;
    labelEn: string;
    color: string;
    bgColor: string;
    icon: LucideIcon;
}

export const CATEGORIES: Record<string, Category> = {
    shopping: {
        id: "shopping",
        emoji: "🛍️",
        label: "Compras",
        labelEn: "shopping",
        color: "text-pink-400",
        bgColor: "bg-pink-400/20",
        icon: ShoppingBag,
    },
    food: {
        id: "food",
        emoji: "🍕",
        label: "Comida",
        labelEn: "food",
        color: "text-orange-400",
        bgColor: "bg-orange-400/20",
        icon: Coffee,
    },
    rent: {
        id: "rent",
        emoji: "🏠",
        label: "Alquiler",
        labelEn: "rent",
        color: "text-blue-400",
        bgColor: "bg-blue-400/20",
        icon: Home,
    },
    utilities: {
        id: "utilities",
        emoji: "💡",
        label: "Recibos",
        labelEn: "utilities",
        color: "text-yellow-400",
        bgColor: "bg-yellow-400/20",
        icon: Lightbulb,
    },
    transport: {
        id: "transport",
        emoji: "🚗",
        label: "Transporte",
        labelEn: "transport",
        color: "text-green-400",
        bgColor: "bg-green-400/20",
        icon: TramFront,
    },
    entertainment: {
        id: "entertainment",
        emoji: "🎬",
        label: "Ocio",
        labelEn: "entertainment",
        color: "text-purple-400",
        bgColor: "bg-purple-400/20",
        icon: Clapperboard,
    },
    health: {
        id: "health",
        emoji: "💊",
        label: "Salud",
        labelEn: "health",
        color: "text-red-400",
        bgColor: "bg-red-400/20",
        icon: Heart,
    },
    other: {
        id: "other",
        emoji: "📦",
        label: "Otro",
        labelEn: "other",
        color: "text-gray-400",
        bgColor: "bg-gray-400/20",
        icon: Receipt,
    },
};

// Helper functions
export const getCategoryById = (id: string): Category => {
    return CATEGORIES[id] || CATEGORIES.other;
};

export const getAllCategories = (): Category[] => {
    return Object.values(CATEGORIES);
};
