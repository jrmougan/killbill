/**
 * Input schemas + shared route() options of the PERSONAL shopping-list routes
 * (/api/me/lists/**).
 *
 * TODO(integración fase 2b): deduplicar con src/lib/list-schemas.ts (lote A, rutas
 * de listas de espacio) al fusionar — las formas son las mismas.
 *
 * Shape only (a JSON object): every field rule — names, lengths, quantity,
 * aisle, order — stays in list-crud.ts, which throws ListError with its machine
 * `code` (INVALID_NAME, INVALID_QUANTITY…) AFTER asserting the list is in scope
 * (404/403 before 400).
 */
import { z } from "zod";
import { id, jsonObject } from "@/lib/http/schemas";

/** Field forwarded as-is to list-crud, which validates it. */
const field = z.unknown().optional();

export const listParams = z.object({ listId: id() });
export const itemParams = z.object({ listId: id(), itemId: id() });

/** POST/PATCH a list: `{ name, description? }`. */
export const ListBody = jsonObject({ name: field, description: field });

/** Reorder (lists or items): `{ order: string[] }` (validated by list-crud: INVALID_ORDER). */
export const OrderBody = jsonObject({ order: field });

/** POST an item / PATCH its fields; PATCH with a boolean `checked` toggles it instead. */
export const ItemBody = jsonObject({
    name: field,
    quantity: field,
    unit: field,
    note: field,
    aisle: field,
    checked: field,
});

/**
 * Historical contract of the personal list routes: 401 "Unauthorized", guests
 * 403 "Acción no permitida para invitados" (they have no personal lists), and
 * an unexpected error is a 500 "Error en las listas".
 */
export const PERSONAL_LIST_ROUTE = {
    auth: "user",
    unauthorizedMessage: "Unauthorized",
    errorMessage: "Error en las listas",
    logLabel: "Shopping list error:",
} as const;
