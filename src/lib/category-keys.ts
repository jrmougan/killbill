/**
 * Pure category-key helpers (Fase 4). Client-safe (no Prisma) so the editor can
 * mirror the server's key rules — reserved-key detection + slugify — without
 * bundling the DB client. `category-crud.ts` imports these so there is exactly
 * one source of truth for both sides.
 */

/** The 8 reserved SYSTEM keys — a custom category may never claim one (decision #1). */
export const RESERVED_SYSTEM_KEYS: ReadonlySet<string> = new Set([
    "shopping",
    "food",
    "rent",
    "utilities",
    "transport",
    "entertainment",
    "health",
    "other",
]);

/** Shape of a valid custom category key. */
export const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Lowercase-slugify a label into a key (accents stripped, non-alphanumerics → '-'). */
export function slugifyKey(label: string): string {
    return label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
}

/** Whether the label would slugify to a reserved system key (editor warning). */
export function slugsToReservedKey(label: string): boolean {
    return RESERVED_SYSTEM_KEYS.has(slugifyKey(label));
}
