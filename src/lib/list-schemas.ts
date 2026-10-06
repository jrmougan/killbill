/**
 * Zod schemas of the shopping-list write bodies, shared by the space
 * (/api/spaces/[id]/lists/**) and personal (/api/me/lists/**) routes.
 *
 * They only check the SHAPE of the body (a JSON object; unknown keys dropped).
 * The field rules — name required/≤ length, quantity (normalizeQuantity), aisle
 * vocabulary, order = exactly the scope's ids — stay in list-crud, which throws
 * ListError with the machine `code` the clients rely on (INVALID_NAME,
 * INVALID_QUANTITY, INVALID_AISLE, INVALID_ORDER, NOTHING_TO_UPDATE…). Duplicating
 * them here would drop those codes, so the fields are passed through as unknown.
 */
import { z } from "zod";
import { id, jsonObject } from "@/lib/http/schemas";

const field = z.unknown().optional();

/** POST lists / PATCH [listId]: `{ name?, description? }`. */
export const ListBody = jsonObject({ name: field, description: field });
export type ListBody = z.output<typeof ListBody>;

/** POST [listId]/items: `{ name, quantity?, unit?, note?, aisle? }`. */
export const ItemBody = jsonObject({ name: field, quantity: field, unit: field, note: field, aisle: field });
export type ItemBody = z.output<typeof ItemBody>;

/**
 * PATCH [listId]/items/[itemId]: a boolean `checked` toggles (idempotent,
 * system-derived field); otherwise the item fields are edited.
 */
export const ItemPatchBody = ItemBody.extend({ checked: field });
export type ItemPatchBody = z.output<typeof ItemPatchBody>;

/** PATCH lists (reorder) / [listId]/items/reorder: `{ order: string[] }` (checked by list-crud). */
export const OrderBody = jsonObject({ order: field });
export type OrderBody = z.output<typeof OrderBody>;

/** Dynamic segments of the space list routes. */
export const spaceListParams = z.object({ id: id(), listId: id() });
export const spaceItemParams = spaceListParams.extend({ itemId: id() });
