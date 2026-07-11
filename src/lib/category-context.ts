/**
 * Category context + client data shape (Fase 4). Pure and import-safe from both
 * server and client — the picker/editor/hook all agree on ONE endpoint mapping
 * and ONE row shape, so the merge from `/api/spaces/[id]/categories` (shared) and
 * `/api/me/categories` (personal) is consumed identically everywhere.
 */

/**
 * Where a category set is read from. XOR by construction (Tag/Budget pattern):
 * a shared expense/budget lives in a space (`groupId`); a personal one has no
 * space, so it is scoped to the caller's session (`/api/me/categories`).
 */
export type CategoryContext =
    | { kind: "shared"; groupId: string }
    | { kind: "personal" };

/**
 * A category as returned by the CRUD GET endpoints (the MERGE with the `editable`
 * flag). `iconName` is the lucide component NAME — resolve it to a component with
 * `getIconComponent`. Colors render inline from `hex` (never tailwind classes).
 */
export interface CategoryListItem {
    id: string;
    key: string;
    label: string;
    labelEn: string;
    emoji: string;
    iconName: string;
    hex: string;
    isSystem: boolean;
    sortOrder: number;
    editable: boolean;
}

/** Endpoint that serves the effective (merged) category set for a context. */
export function categoriesEndpoint(ctx: CategoryContext): string {
    return ctx.kind === "shared"
        ? `/api/spaces/${ctx.groupId}/categories`
        : `/api/me/categories`;
}

/** Endpoint that duplicates a category (system or custom) into the context (Fase 6). */
export function duplicateCategoryEndpoint(ctx: CategoryContext): string {
    return `${categoriesEndpoint(ctx)}/duplicate`;
}
