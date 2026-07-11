/**
 * Shared CRUD + validation for shopping lists and their items.
 *
 * Both the space API (`/api/spaces/[id]/lists/...`) and the personal API
 * (`/api/me/lists/...`) reuse this module: the routes only own AUTHORIZATION
 * (requireSpaceAccess vs getSessionCtx), while all validation, scope/XOR
 * enforcement, sortOrder allocation and the idempotent toggle live here — one
 * place, one behaviour. Mirrors `category-crud.ts`.
 *
 * The list is a PLANNING tool for the physical shop (what's missing, who grabs
 * it, in which aisle order, ticked off together in near-real-time). The expense
 * itself is materialized by the receipt OCR, NOT by the list — there is no
 * list→expense bridge.
 *
 * Scope decisions (owner-fixed, see the task brief):
 *  - A list is of a GROUP (`groupId`) or PERSONAL (`ownerId`) — XOR, discriminated.
 *  - Any ACTIVE member may create/edit/delete lists AND items (no role gate); the
 *    space writability gate lives in the route (requireSpaceAccess). GUEST out of v1.
 *  - `checked` toggles via a condition-by-id updateMany (never read-modify-write),
 *    so two shoppers marking the same item can never corrupt state.
 *  - `aisle` (supermarket aisle) is an OPTIONAL per-item category, auto-assigned
 *    from the name and validated against the aisle vocabulary (see ./aisles).
 */
import { prisma } from "./db";
import { normalizeAisle, autoAssignAisle } from "./aisles";

const MAX_LIST_NAME = 60;
const MAX_DESCRIPTION = 200;
const MAX_ITEM_NAME = 80;
const MAX_UNIT = 20;
const MAX_NOTE = 200;
const MAX_QUANTITY = 100000;

/**
 * Write scope for a list mutation. XOR by construction (discriminated union): a
 * group list carries a `groupId`, a personal one an `ownerId`.
 */
export type ListWriteScope =
    | { kind: "group"; groupId: string }
    | { kind: "owner"; ownerId: string };

/** Typed CRUD error carrying the HTTP status + machine code for the route to surface. */
export class ListError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "ListError";
        this.status = status;
        this.code = code;
    }
}

export interface ListCreateInput {
    name?: unknown;
    description?: unknown;
}
export interface ListPatchInput {
    name?: unknown;
    description?: unknown;
}
export interface ItemCreateInput {
    name?: unknown;
    quantity?: unknown;
    unit?: unknown;
    note?: unknown;
    aisle?: unknown;
}
export type ItemPatchInput = ItemCreateInput;

/** Prisma `where` fragment selecting the rows of a scope. */
function scopeWhere(scope: ListWriteScope): { groupId: string } | { ownerId: string } {
    return scope.kind === "group" ? { groupId: scope.groupId } : { ownerId: scope.ownerId };
}

/** Fields written to place a row in its scope (the non-owning discriminant stays null). */
function scopeOwnership(scope: ListWriteScope): { groupId: string | null; ownerId: string | null } {
    return scope.kind === "group"
        ? { groupId: scope.groupId, ownerId: null }
        : { groupId: null, ownerId: scope.ownerId };
}

// ── validators ──────────────────────────────────────────────────────────────

function validateName(raw: unknown, code = "INVALID_NAME"): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new ListError(400, code, "El nombre es obligatorio");
    }
    const name = raw.trim();
    if (name.length > MAX_LIST_NAME) {
        throw new ListError(400, code, `El nombre no puede superar ${MAX_LIST_NAME} caracteres`);
    }
    return name;
}

function validateItemName(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new ListError(400, "INVALID_ITEM_NAME", "El nombre del artículo es obligatorio");
    }
    const name = raw.trim();
    if (name.length > MAX_ITEM_NAME) {
        throw new ListError(400, "INVALID_ITEM_NAME", `El nombre no puede superar ${MAX_ITEM_NAME} caracteres`);
    }
    return name;
}

/** Optional free text → trimmed string or null (empty ⇒ null). */
function validateOptionalText(raw: unknown, max: number, code: string): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "string") throw new ListError(400, code, "Texto no válido");
    const t = raw.trim();
    if (t.length === 0) return null;
    if (t.length > max) throw new ListError(400, code, `El texto no puede superar ${max} caracteres`);
    return t;
}

/** Optional positive integer quantity → int or null. */
function validateQuantity(raw: unknown): number | null {
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > MAX_QUANTITY) {
        throw new ListError(400, "INVALID_QUANTITY", "La cantidad debe ser un entero positivo");
    }
    return raw;
}

/**
 * Optional aisle key. `null` clears it; a non-empty string must be a valid aisle
 * key (validated + normalized against the aisle vocabulary). Empty/undefined ⇒
 * left untouched at the caller (create resolves it, patch skips it).
 */
function validateAisle(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "string") throw new ListError(400, "INVALID_AISLE", "Pasillo no válido");
    const key = normalizeAisle(raw);
    if (!key) throw new ListError(400, "INVALID_AISLE", "Pasillo no válido");
    return key;
}

// ── loaders (scope enforcement) ───────────────────────────────────────────────

/** Load a list and assert it belongs to this scope (404 if missing, 403 if foreign). */
async function loadListInScope(scope: ListWriteScope, listId: string) {
    if (typeof listId !== "string" || listId.length === 0) {
        throw new ListError(400, "INVALID_LIST", "Falta el identificador de la lista");
    }
    const list = await prisma.shoppingList.findUnique({ where: { id: listId } });
    if (!list) throw new ListError(404, "LIST_NOT_FOUND", "Lista no encontrada");
    const inScope = scope.kind === "group" ? list.groupId === scope.groupId : list.ownerId === scope.ownerId;
    if (!inScope) throw new ListError(403, "LIST_OUT_OF_SCOPE", "Esa lista no pertenece a este contexto");
    return list;
}

// ── list CRUD ────────────────────────────────────────────────────────────────

/** Next sortOrder for a scope = max(existing) + 1. */
async function nextListSortOrder(scope: ListWriteScope): Promise<number> {
    const agg = await prisma.shoppingList.aggregate({ where: scopeWhere(scope), _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? 0) + 1;
}

/** Create a list in a scope. Any ACTIVE member (no role gate). */
export async function createListForScope(scope: ListWriteScope, input: ListCreateInput, createdById: string) {
    const name = validateName(input.name);
    const description = validateOptionalText(input.description, MAX_DESCRIPTION, "INVALID_DESCRIPTION");
    const sortOrder = await nextListSortOrder(scope);
    return prisma.shoppingList.create({
        data: { name, description, sortOrder, createdById, ...scopeOwnership(scope) },
    });
}

/** Rename / edit description of a list. */
export async function updateListForScope(scope: ListWriteScope, listId: string, patch: ListPatchInput) {
    await loadListInScope(scope, listId);
    const data: { name?: string; description?: string | null } = {};
    if (patch.name !== undefined) data.name = validateName(patch.name);
    if (patch.description !== undefined) {
        data.description = validateOptionalText(patch.description, MAX_DESCRIPTION, "INVALID_DESCRIPTION");
    }
    if (Object.keys(data).length === 0) {
        throw new ListError(400, "NOTHING_TO_UPDATE", "Nada que actualizar");
    }
    return prisma.shoppingList.update({ where: { id: listId }, data });
}

/** Delete a list (Cascade removes its items). Idempotent: 404 when nothing deleted. */
export async function deleteListForScope(scope: ListWriteScope, listId: string) {
    const res = await prisma.shoppingList.deleteMany({ where: { id: listId, ...scopeWhere(scope) } });
    if (res.count === 0) throw new ListError(404, "LIST_NOT_FOUND", "Lista no encontrada");
    return { deleted: listId };
}

/** Reorder the lists of a scope. `orderedIds` must be exactly this scope's list ids. */
export async function reorderListsForScope(scope: ListWriteScope, orderedIds: unknown) {
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
        throw new ListError(400, "INVALID_ORDER", "Orden no válido");
    }
    const lists = await prisma.shoppingList.findMany({ where: scopeWhere(scope), select: { id: true } });
    const ids = new Set(lists.map((l) => l.id));
    if (orderedIds.length !== ids.size || orderedIds.some((id) => !ids.has(id))) {
        throw new ListError(400, "INVALID_ORDER", "El orden debe incluir exactamente las listas del contexto");
    }
    await prisma.$transaction(
        (orderedIds as string[]).map((id, i) =>
            prisma.shoppingList.update({ where: { id }, data: { sortOrder: i + 1 } }),
        ),
    );
    return { reordered: orderedIds.length };
}

// ── item CRUD ────────────────────────────────────────────────────────────────

/** Next item sortOrder within a list = max(existing) + 1. */
async function nextItemSortOrder(listId: string): Promise<number> {
    const agg = await prisma.shoppingListItem.aggregate({ where: { listId }, _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? 0) + 1;
}

/** Add an item to a list. Fast capture: only `name` is required. */
export async function createItemForScope(scope: ListWriteScope, listId: string, input: ItemCreateInput) {
    await loadListInScope(scope, listId);
    const name = validateItemName(input.name);
    const quantity = validateQuantity(input.quantity);
    const unit = validateOptionalText(input.unit, MAX_UNIT, "INVALID_UNIT");
    const note = validateOptionalText(input.note, MAX_NOTE, "INVALID_NOTE");
    // Aisle: honour an explicit valid key, else auto-assign from the name (nullable).
    const aisle = input.aisle !== undefined ? validateAisle(input.aisle) : autoAssignAisle(name);
    const sortOrder = await nextItemSortOrder(listId);
    return prisma.shoppingListItem.create({
        data: { listId, name, quantity, unit, note, aisle, sortOrder },
    });
}

/** Load an item and assert it belongs to a list of this scope. */
async function loadItemInScope(scope: ListWriteScope, listId: string, itemId: string) {
    await loadListInScope(scope, listId);
    if (typeof itemId !== "string" || itemId.length === 0) {
        throw new ListError(400, "INVALID_ITEM", "Falta el identificador del artículo");
    }
    const item = await prisma.shoppingListItem.findUnique({ where: { id: itemId } });
    if (!item || item.listId !== listId) throw new ListError(404, "ITEM_NOT_FOUND", "Artículo no encontrado");
    return item;
}

/** Edit an item's non-checked fields (name/quantity/unit/note/aisle). */
export async function updateItemForScope(
    scope: ListWriteScope,
    listId: string,
    itemId: string,
    patch: ItemPatchInput,
) {
    await loadItemInScope(scope, listId, itemId);
    const data: {
        name?: string;
        quantity?: number | null;
        unit?: string | null;
        note?: string | null;
        aisle?: string | null;
    } = {};
    if (patch.name !== undefined) data.name = validateItemName(patch.name);
    if (patch.quantity !== undefined) data.quantity = validateQuantity(patch.quantity);
    if (patch.unit !== undefined) data.unit = validateOptionalText(patch.unit, MAX_UNIT, "INVALID_UNIT");
    if (patch.note !== undefined) data.note = validateOptionalText(patch.note, MAX_NOTE, "INVALID_NOTE");
    if (patch.aisle !== undefined) data.aisle = validateAisle(patch.aisle);
    if (Object.keys(data).length === 0) {
        throw new ListError(400, "NOTHING_TO_UPDATE", "Nada que actualizar");
    }
    return prisma.shoppingListItem.update({ where: { id: itemId }, data });
}

/**
 * Set an item's `checked` state IDEMPOTENTLY. Condition-by-id updateMany
 * (`where {id, listId, checked: !desired}`) — never read-modify-write — so two
 * shoppers marking the same item concurrently converge without corruption. A
 * no-op (already in the desired state) returns `changed:false` but still 200.
 */
export async function setItemChecked(
    scope: ListWriteScope,
    listId: string,
    itemId: string,
    checked: boolean,
    actorUserId: string,
) {
    await loadItemInScope(scope, listId, itemId);
    const res = await prisma.shoppingListItem.updateMany({
        where: { id: itemId, listId, checked: !checked },
        data: checked
            ? { checked: true, checkedById: actorUserId, checkedAt: new Date() }
            : { checked: false, checkedById: null, checkedAt: null },
    });
    return { changed: res.count > 0, checked };
}

/** Delete an item. Idempotent: 404 when nothing deleted. */
export async function deleteItemForScope(scope: ListWriteScope, listId: string, itemId: string) {
    await loadListInScope(scope, listId);
    const res = await prisma.shoppingListItem.deleteMany({ where: { id: itemId, listId } });
    if (res.count === 0) throw new ListError(404, "ITEM_NOT_FOUND", "Artículo no encontrado");
    return { deleted: itemId };
}

/** Reorder the items of a list. `orderedIds` must be exactly this list's item ids. */
export async function reorderItemsForScope(scope: ListWriteScope, listId: string, orderedIds: unknown) {
    await loadListInScope(scope, listId);
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
        throw new ListError(400, "INVALID_ORDER", "Orden no válido");
    }
    const items = await prisma.shoppingListItem.findMany({ where: { listId }, select: { id: true } });
    const ids = new Set(items.map((i) => i.id));
    if (orderedIds.length !== ids.size || orderedIds.some((id) => !ids.has(id))) {
        throw new ListError(400, "INVALID_ORDER", "El orden debe incluir exactamente los artículos de la lista");
    }
    await prisma.$transaction(
        (orderedIds as string[]).map((id, i) =>
            prisma.shoppingListItem.update({ where: { id }, data: { sortOrder: i + 1 } }),
        ),
    );
    return { reordered: orderedIds.length };
}

/**
 * "Vaciar comprados": DELETE the checked items of a list to recycle the weekly
 * list without recreating it. A scoped deleteMany (list asserted in scope first)
 * — the owner-fixed decision is to DELETE the checked rows, not just uncheck them.
 * Idempotent: returns the count removed (0 when nothing was checked).
 */
export async function clearCheckedForScope(scope: ListWriteScope, listId: string) {
    await loadListInScope(scope, listId);
    const res = await prisma.shoppingListItem.deleteMany({ where: { listId, checked: true } });
    return { cleared: res.count };
}
