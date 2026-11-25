/**
 * "Terminar y apuntar gasto" — shortcut WITHOUT link (docs/design/README.md).
 *
 * A shopping list never generates an expense: the shortcut only clears the
 * checked items (`clear-checked`) and opens the add-expense form prefilled with
 * the list name as concept, the groceries system category and the list's space.
 * Nothing about the list is persisted on the expense (no linkedExpenseId, no
 * prices) — the money still comes from the receipt OCR (`scan=1`) or manual entry.
 */

/**
 * System category used for supermarket spend. Must be a seeded system key
 * (prisma/seed.ts); the receipt OCR prompt maps "supermercado" to it as well.
 */
export const GROCERIES_CATEGORY_KEY = "shopping";

export function buildFinishExpenseUrl(list: { id: string; name: string; groupId: string | null }): string {
    const params = new URLSearchParams({
        title: list.name,
        category: GROCERIES_CATEGORY_KEY,
        space: list.groupId ?? "personal",
        returnTo: `/lists/${list.id}`,
        scan: "1",
    });
    return `/expenses/new?${params.toString()}`;
}
