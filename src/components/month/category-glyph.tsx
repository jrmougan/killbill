import { getIconComponent } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import type { MonthCategory } from "./types";

/** Category emoji (prototype style); falls back to its lucide icon tinted with its hex. */
export function CategoryGlyph({ category, className }: { category: Pick<MonthCategory, "emoji" | "iconName" | "hex">; className?: string }) {
    if (category.emoji) {
        return <span aria-hidden className={cn("leading-none", className)}>{category.emoji}</span>;
    }
    const Icon = getIconComponent(category.iconName);
    return <Icon aria-hidden className={cn("h-4 w-4 flex-none", className)} style={{ color: category.hex || undefined }} />;
}
