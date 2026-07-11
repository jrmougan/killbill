/**
 * Phase 4 read-switch (2b): the Category TABLE is the effective read key for
 * server-side grouping/filtering by category.
 *
 * `categoryRef.key` (joined via Expense.categoryId / Budget.categoryId) wins;
 * the legacy `category` enum column is only a fallback for rows whose
 * categoryId is still NULL (not yet backfilled, or a deleted custom category —
 * the FK has no cascade, but defensive fallback keeps reads total).
 *
 * Today this is behavior-identical to reading the enum: every live row is
 * backfilled + dual-written and the 8 system Category rows mirror the
 * ExpenseCategory enum key-for-key. Once group-custom categories exist, the
 * table key diverges from (and supersedes) the enum.
 *
 * Pure on purpose: server pages, API routes and unit tests all share it
 * without pulling in Prisma.
 */
export interface CategoryKeyed {
    /**
     * Legacy ExpenseCategory enum value. Nullable since Phase 5 stopped writing
     * Budget.category (new Budget rows carry NULL here); the categoryRef.key wins
     * and 'other' is the final fallback, so a null enum is always safe.
     */
    category?: string | null;
    /** Joined relational category (select at least { key }). */
    categoryRef?: { key: string } | null;
}

/** Effective category key of a row: relational key, else enum, else 'other'. */
export function categoryKeyOf(row: CategoryKeyed): string {
    return row.categoryRef?.key ?? row.category ?? "other";
}

/**
 * Prisma `select` fragment for the full visual metadata of a Category row. The
 * DB column is `icon` (a lucide component NAME); `toCategoryMeta` renames it to
 * `iconName` for the render layer. Single source for the merge helper and the
 * expanded CATEGORY_REF_SELECT below.
 */
export const CATEGORY_META_SELECT = {
    id: true,
    key: true,
    label: true,
    labelEn: true,
    emoji: true,
    icon: true,
    hex: true,
    isSystem: true,
    sortOrder: true,
} as const;

/**
 * Prisma `include`/`select` fragment for the relational category. Spread it into
 * any Expense/Budget query whose result is grouped/rendered by category. It now
 * carries the full visual metadata (emoji/icon/hex/label/…) so server pages and
 * API routes can emit DB-driven `categoryMeta` without a second query.
 * `categoryKeyOf` only reads `.key`, so this stays backward-compatible.
 */
export const CATEGORY_REF_SELECT = { categoryRef: { select: CATEGORY_META_SELECT } } as const;

/**
 * A Category row as selected by CATEGORY_META_SELECT (DB shape — `icon` is the
 * lucide component name).
 */
export interface CategoryRow {
    id: string;
    key: string;
    label: string;
    labelEn: string;
    emoji: string;
    icon: string;
    hex: string;
    isSystem: boolean;
    sortOrder: number;
}

/**
 * Render-facing category metadata. `iconName` is the lucide component name
 * (resolve to a component via ICON_REGISTRY / getIconComponent). Colors are
 * rendered inline from `hex` (never tailwind classes — the JIT purges dynamic
 * ones).
 */
export interface CategoryMeta {
    id: string;
    key: string;
    label: string;
    labelEn: string;
    emoji: string;
    iconName: string;
    hex: string;
    isSystem: boolean;
    sortOrder: number;
}

/** Map a DB Category row to render-facing metadata (`icon` → `iconName`). */
export function toCategoryMeta(row: CategoryRow): CategoryMeta {
    return {
        id: row.id,
        key: row.key,
        label: row.label,
        labelEn: row.labelEn,
        emoji: row.emoji,
        iconName: row.icon,
        hex: row.hex,
        isSystem: row.isSystem,
        sortOrder: row.sortOrder,
    };
}

/**
 * Effective category set of a context = system ∪ context-custom, where a custom
 * row SHADOWS the system row with the same key (intended divergence — a group/
 * personal `food` overrides the system `food`). Ordered by (sortOrder, key).
 *
 * Pure so it can be unit-tested and reused from server pages and API routes; the
 * DB fetch that feeds it (`getEffectiveCategories`) lives in category-db.ts.
 */
export function mergeCategories(system: CategoryRow[], custom: CategoryRow[]): CategoryMeta[] {
    const byKey = new Map<string, CategoryMeta>();
    for (const row of system) byKey.set(row.key, toCategoryMeta(row));
    for (const row of custom) byKey.set(row.key, toCategoryMeta(row)); // custom shadows system
    return [...byKey.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
    );
}
