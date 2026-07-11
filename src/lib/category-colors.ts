/**
 * Closed color palette for categories (product decision #8: paleta CERRADA).
 *
 * Custom categories may only pick a hex from this curated set — there is no
 * free-form hex in V1. Rendering is ALWAYS inline via the `hex` value (never a
 * dynamic tailwind class — the JIT purges those). The 8 system-category hexes
 * are included so a custom category can reuse a system color and so the whole
 * render path is unified on `hex`.
 *
 * Single source: the color-swatch picker offers exactly `CATEGORY_PALETTE`, and
 * the server validates membership via `isValidCategoryHex` (400 otherwise).
 */
export const CATEGORY_PALETTE: string[] = [
    // --- The 8 system-category hexes (keep in sync with src/lib/categories.ts) ---
    "#f472b6", // shopping (pink)
    "#fb923c", // food (orange)
    "#60a5fa", // rent (blue)
    "#facc15", // utilities (yellow)
    "#4ade80", // transport (green)
    "#c084fc", // entertainment (purple)
    "#f87171", // health (red)
    "#9ca3af", // other (gray)
    // --- Extra curated swatches for custom categories ---
    "#8b5cf6", // violet
    "#06b6d4", // cyan
    "#10b981", // emerald
    "#ef4444", // red-strong
    "#ec4899", // magenta
    "#3b82f6", // blue-strong
    "#84cc16", // lime
    "#14b8a6", // teal
    "#f43f5e", // rose
    "#eab308", // amber-strong
    "#a855f7", // purple-strong
    "#0ea5e9", // sky
];

/**
 * Neutral fallback color for an orphaned / unresolved category key (the `other`
 * gray). Keep in sync with the `other` system hex.
 */
export const NEUTRAL_CATEGORY_HEX = "#9ca3af";

/**
 * Compose an 8-digit `#rrggbbaa` from a 6-digit hex + a 0–1 alpha. Used for the
 * ~10% tinted chip/tile backgrounds (render is inline, never a tailwind class).
 * A non-`#rrggbb` input falls back to the neutral hex so the render never breaks.
 */
export function hexWithAlpha(hex: string, alpha: number): string {
    const base = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : NEUTRAL_CATEGORY_HEX;
    const a = Math.max(0, Math.min(1, alpha));
    const aa = Math.round(a * 255).toString(16).padStart(2, "0");
    return `${base}${aa}`;
}

/** Lowercased lookup set for O(1) membership checks. */
const PALETTE_SET = new Set(CATEGORY_PALETTE.map((c) => c.toLowerCase()));

/** Shape of a valid 6-digit hex color. */
const HEX_RE = /^#[0-9a-f]{6}$/;

/**
 * Whether a hex string is a valid, in-palette color (server validation).
 * Enforces BOTH the `#rrggbb` shape AND closed-palette membership (decision #8).
 */
export function isValidCategoryHex(hex: unknown): hex is string {
    if (typeof hex !== "string") return false;
    const normalized = hex.toLowerCase();
    return HEX_RE.test(normalized) && PALETTE_SET.has(normalized);
}
