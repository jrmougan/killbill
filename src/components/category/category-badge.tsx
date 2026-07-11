/**
 * CategoryBadge — the single, pure, DB-driven category tile (Fase 4).
 *
 * Renders from render-facing metadata (`{emoji, label, hex, iconName}`) only:
 *   - color ALWAYS inline via `hex` (never a dynamic tailwind class — the JIT
 *     purges those);
 *   - icons ALWAYS resolved through ICON_REGISTRY (string → component), never a
 *     lucide import at the call site.
 *
 * Works in server and client components (no hooks). Two visual variants cover
 * every call site: an emoji tile (dashboard/list/settle) and an icon tile
 * (budget). A missing/undefined meta degrades to a neutral gray tile so a
 * render can never crash on an orphaned key.
 */
import { getIconComponent } from "@/lib/category-icons";
import { hexWithAlpha, NEUTRAL_CATEGORY_HEX } from "@/lib/category-colors";

/** Minimal render-facing shape a badge needs (subset of CategoryMeta). */
export interface CategoryBadgeMeta {
    key?: string;
    emoji: string;
    label: string;
    hex: string;
    iconName?: string | null;
}

/** Neutral fallback used when no metadata resolves for a key. */
export const NEUTRAL_CATEGORY_META: CategoryBadgeMeta = {
    key: "other",
    emoji: "📦",
    label: "Otro",
    hex: NEUTRAL_CATEGORY_HEX,
    iconName: "Receipt",
};

interface CategoryBadgeProps {
    meta: CategoryBadgeMeta | null | undefined;
    /** `emoji` = colored tile with the emoji; `icon` = colored tile with the lucide icon. */
    variant?: "emoji" | "icon";
    /** Tile side length in px (default 42). */
    size?: number;
    /** Corner radius in px (default 11). */
    radius?: number;
    className?: string;
}

/**
 * The colored category tile. Background is the `hex` at ~12% alpha; the icon (in
 * `icon` variant) is drawn in the full `hex`.
 */
export function CategoryBadge({
    meta,
    variant = "emoji",
    size = 42,
    radius = 11,
    className,
}: CategoryBadgeProps) {
    const m = meta ?? NEUTRAL_CATEGORY_META;
    const style: React.CSSProperties = {
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: hexWithAlpha(m.hex, 0.12),
    };

    return (
        <div
            className={`flex items-center justify-center shrink-0 ${className ?? ""}`}
            style={style}
            aria-hidden={variant === "emoji" ? undefined : true}
        >
            {variant === "emoji" ? (
                <span style={{ fontSize: Math.round(size * 0.48), lineHeight: 1 }}>{m.emoji}</span>
            ) : (
                (() => {
                    const Icon = getIconComponent(m.iconName);
                    return <Icon style={{ color: m.hex }} size={Math.round(size * 0.46)} />;
                })()
            )}
        </div>
    );
}
