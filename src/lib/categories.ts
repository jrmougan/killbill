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
    scannable: boolean; // Whether OCR scanning makes sense for this category
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
        scannable: true,
    },
    food: {
        id: "food",
        emoji: "🍕",
        label: "Comida",
        labelEn: "food",
        color: "text-orange-400",
        bgColor: "bg-orange-400/20",
        icon: Coffee,
        scannable: true,
    },
    rent: {
        id: "rent",
        emoji: "🏠",
        label: "Alquiler",
        labelEn: "rent",
        color: "text-blue-400",
        bgColor: "bg-blue-400/20",
        icon: Home,
        scannable: false,
    },
    utilities: {
        id: "utilities",
        emoji: "💡",
        label: "Recibos",
        labelEn: "utilities",
        color: "text-yellow-400",
        bgColor: "bg-yellow-400/20",
        icon: Lightbulb,
        scannable: false,
    },
    transport: {
        id: "transport",
        emoji: "🚗",
        label: "Transporte",
        labelEn: "transport",
        color: "text-green-400",
        bgColor: "bg-green-400/20",
        icon: TramFront,
        scannable: false,
    },
    entertainment: {
        id: "entertainment",
        emoji: "🎬",
        label: "Ocio",
        labelEn: "entertainment",
        color: "text-purple-400",
        bgColor: "bg-purple-400/20",
        icon: Clapperboard,
        scannable: false,
    },
    health: {
        id: "health",
        emoji: "💊",
        label: "Salud",
        labelEn: "health",
        color: "text-red-400",
        bgColor: "bg-red-400/20",
        icon: Heart,
        scannable: true,
    },
    other: {
        id: "other",
        emoji: "📦",
        label: "Otro",
        labelEn: "other",
        color: "text-gray-400",
        bgColor: "bg-gray-400/20",
        icon: Receipt,
        scannable: true,
    },
};

// Helper functions
export const getCategoryById = (id: string): Category => {
    return CATEGORIES[id] || CATEGORIES.other;
};

export const getScannableCategories = (): string[] => {
    return Object.values(CATEGORIES)
        .filter(cat => cat.scannable)
        .map(cat => cat.id);
};

export const getAllCategories = (): Category[] => {
    return Object.values(CATEGORIES);
};

export const getCategoryColor = (id: string): string => {
    const cat = getCategoryById(id);
    return `${cat.color} ${cat.bgColor}`;
};
