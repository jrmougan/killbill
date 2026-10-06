/**
 * Zod schemas of the category CRUD inputs (/api/me/categories and
 * /api/spaces/[id]/categories). They only enforce the request SHAPE (a JSON
 * object, the query id): every field rule — label/emoji/icon/palette hex, key
 * slug, reserved keys, scope, reassignment — stays in category-crud.ts, which
 * throws CategoryError with its machine `code` (INVALID_LABEL, INVALID_COLOR…)
 * AFTER the row was loaded in scope (404/403 before 400). Duplicating those
 * rules here would drop the codes clients rely on and reorder the checks.
 */
import { z } from "zod";
import { jsonObject } from "@/lib/http/schemas";

/** Field forwarded as-is to category-crud, which validates it. */
const field = z.unknown().optional();

export const CATEGORY_ID_REQUIRED = "Falta el id de la categoría";

/** POST: create a custom category. */
export const CategoryCreateBody = jsonObject({
    key: field,
    label: field,
    labelEn: field,
    emoji: field,
    iconName: field,
    hex: field,
});
export type CategoryCreateBody = z.output<typeof CategoryCreateBody>;

/**
 * PATCH: `{ order: string[] }` reorders; otherwise `{ id, ...fields }` edits one
 * row (a missing/non-string id is the handler's 400 "Falta el id de la categoría").
 */
export const CategoryPatchBody = jsonObject({
    order: field,
    id: field,
    label: field,
    labelEn: field,
    emoji: field,
    iconName: field,
    hex: field,
});
export type CategoryPatchBody = z.output<typeof CategoryPatchBody>;

/** POST …/duplicate: `{ sourceId }` (missing → CategoryError SOURCE_REQUIRED). */
export const CategoryDuplicateBody = jsonObject({ sourceId: field });

/** DELETE ?id=&reassignTo= (missing reassignTo → CategoryError REASSIGN_REQUIRED). */
export const CategoryDeleteQuery = z.object({
    id: z.string({ error: CATEGORY_ID_REQUIRED }).min(1, CATEGORY_ID_REQUIRED),
    reassignTo: z.string().optional(),
});
