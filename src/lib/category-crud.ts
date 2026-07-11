/**
 * Shared CRUD + validation for custom categories (Fase 3).
 *
 * Both the space API (`/api/spaces/[id]/categories`) and the personal API
 * (`/api/me/categories`) reuse this module: the routes only own AUTHORIZATION
 * (requireSpaceAccess vs getSessionCtx), while all validation, ownership/XOR
 * enforcement, uniqueness, sortOrder allocation and the delete-with-reassignment
 * transaction live here — one place, one behaviour.
 *
 * Product decisions honoured (see the task brief / plan §5):
 *  #1  Creating a custom with a reserved SYSTEM key → 400 (no UI shadowing in V1).
 *  #3  Budget unique collision while reassigning on delete → 409 (never merge/overwrite).
 *  #4  labelEn stays NOT NULL; if omitted it is COPIED from label on the server.
 *  #6  Only OWNER/ADMIN may write space categories (enforced by the route gate).
 *  #7  Delete REQUIRES an explicit reassignment target (no orphan / silent 'other').
 *  #8  Color must be a hex from the CLOSED palette (isValidCategoryHex).
 *
 * `isSystem` is FORCED to false on the server; `color`/`bgColor` are NOT NULL with
 * no default → written as empty strings (the render layer uses `hex`, never the
 * legacy tailwind-class columns).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "./db";
import { isValidIconName } from "./category-icons";
import { isValidCategoryHex } from "./category-colors";

/** The 8 reserved system keys — a custom category may never claim one (decision #1). */
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

const MAX_LABEL_LEN = 40;
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Write scope for a category mutation. XOR by construction (a discriminated
 * union): a space category carries a `groupId`, a personal one an `ownerId`.
 */
export type CategoryWriteScope =
    | { kind: "group"; groupId: string }
    | { kind: "owner"; ownerId: string };

/** Typed CRUD error carrying the HTTP status + machine code for the route to surface. */
export class CategoryError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "CategoryError";
        this.status = status;
        this.code = code;
    }
}

export interface CategoryCreateInput {
    key?: unknown;
    label?: unknown;
    labelEn?: unknown;
    emoji?: unknown;
    iconName?: unknown;
    hex?: unknown;
}

export type CategoryPatchInput = Omit<CategoryCreateInput, "key">;

/** Prisma client surface (helpers here only ever run against the base client). */
type Db = PrismaClient;

/** Prisma `where` fragment selecting the CUSTOM rows of a scope. */
function scopeWhere(scope: CategoryWriteScope): { groupId: string } | { ownerId: string } {
    return scope.kind === "group" ? { groupId: scope.groupId } : { ownerId: scope.ownerId };
}

/** Fields written to place a row in its scope (the non-owning discriminant stays null). */
function scopeOwnership(scope: CategoryWriteScope): { groupId: string | null; ownerId: string | null } {
    return scope.kind === "group"
        ? { groupId: scope.groupId, ownerId: null }
        : { groupId: null, ownerId: scope.ownerId };
}

/** Count graphemes with Intl.Segmenter (falls back to code points where unavailable). */
function graphemeCount(s: string): number {
    const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (Seg) {
        const seg = new Seg("es", { granularity: "grapheme" });
        return [...seg.segment(s)].length;
    }
    return [...s].length;
}

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

function validateLabel(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new CategoryError(400, "INVALID_LABEL", "El nombre es obligatorio");
    }
    const label = raw.trim();
    if (label.length > MAX_LABEL_LEN) {
        throw new CategoryError(400, "INVALID_LABEL", `El nombre no puede superar ${MAX_LABEL_LEN} caracteres`);
    }
    return label;
}

function validateEmoji(raw: unknown): string {
    if (typeof raw !== "string") {
        throw new CategoryError(400, "INVALID_EMOJI", "El emoji es obligatorio");
    }
    const emoji = raw.trim();
    if (emoji.length === 0 || graphemeCount(emoji) !== 1) {
        throw new CategoryError(400, "INVALID_EMOJI", "El emoji debe ser un único carácter");
    }
    return emoji;
}

function validateIcon(raw: unknown): string {
    if (typeof raw !== "string" || !isValidIconName(raw)) {
        throw new CategoryError(400, "INVALID_ICON", "Icono no válido");
    }
    return raw;
}

function validateHex(raw: unknown): string {
    if (!isValidCategoryHex(raw)) {
        throw new CategoryError(400, "INVALID_COLOR", "Color no válido (fuera de la paleta)");
    }
    return raw.toLowerCase();
}

/** Derive + validate the stable key of a new custom category. */
function resolveKey(input: CategoryCreateInput, label: string): string {
    const raw = typeof input.key === "string" && input.key.trim().length > 0
        ? input.key.trim().toLowerCase()
        : slugifyKey(label);
    if (!KEY_RE.test(raw)) {
        throw new CategoryError(400, "INVALID_KEY", "Clave no válida");
    }
    // Decision #1: no shadowing of the 8 system keys via the API/UI in V1.
    if (RESERVED_SYSTEM_KEYS.has(raw)) {
        throw new CategoryError(400, "RESERVED_KEY", "Esa clave está reservada por el sistema");
    }
    return raw;
}

/** Next sortOrder for a scope = max(existing) + 1 (custom rows only). */
async function nextSortOrder(db: Db, scope: CategoryWriteScope): Promise<number> {
    const agg = await db.category.aggregate({
        where: scopeWhere(scope),
        _max: { sortOrder: true },
    });
    return (agg._max.sortOrder ?? 0) + 1;
}

/**
 * Create a custom category in a scope.
 * - reserved system key → 400 (decision #1)
 * - duplicate key in scope → 409
 * - isSystem forced false; color/bgColor written empty; labelEn copied from label.
 */
export async function createCategoryForScope(scope: CategoryWriteScope, input: CategoryCreateInput) {
    const label = validateLabel(input.label);
    const key = resolveKey(input, label);
    const emoji = validateEmoji(input.emoji);
    const iconName = validateIcon(input.iconName);
    const hex = validateHex(input.hex);
    const labelEn = typeof input.labelEn === "string" && input.labelEn.trim().length > 0
        ? input.labelEn.trim()
        : label; // decision #4: copy label when labelEn is omitted.

    const existing = await prisma.category.findFirst({
        where: { ...scopeWhere(scope), key },
        select: { id: true },
    });
    if (existing) {
        throw new CategoryError(409, "DUPLICATE_KEY", "Ya existe una categoría con esa clave");
    }

    const sortOrder = await nextSortOrder(prisma, scope);

    return prisma.category.create({
        data: {
            key,
            label,
            labelEn,
            emoji,
            icon: iconName, // DB column `icon` stores the lucide component NAME.
            color: "", // NOT NULL, unused (render uses hex).
            bgColor: "", // NOT NULL, unused (render uses hex).
            hex,
            sortOrder,
            isSystem: false, // FORCED — never trust the client.
            ...scopeOwnership(scope),
        },
    });
}

/** Load a custom category and assert it is editable in this scope (not system, in scope). */
async function loadEditable(db: Db, scope: CategoryWriteScope, id: string) {
    const cat = await db.category.findUnique({ where: { id } });
    if (!cat) {
        throw new CategoryError(404, "NOT_FOUND", "Categoría no encontrada");
    }
    if (cat.isSystem) {
        throw new CategoryError(403, "SYSTEM_CATEGORY", "No puedes modificar una categoría del sistema");
    }
    const inScope = scope.kind === "group"
        ? cat.groupId === scope.groupId
        : cat.ownerId === scope.ownerId;
    if (!inScope) {
        throw new CategoryError(403, "OUT_OF_SCOPE", "Esa categoría no pertenece a este contexto");
    }
    return cat;
}

/**
 * Patch a custom category. Only visual fields change (key is stable and never
 * edited). System rows / out-of-scope rows → 403.
 */
export async function updateCategoryForScope(scope: CategoryWriteScope, id: string, patch: CategoryPatchInput) {
    await loadEditable(prisma, scope, id);

    const data: {
        label?: string;
        labelEn?: string;
        emoji?: string;
        icon?: string;
        hex?: string;
    } = {};

    if (patch.label !== undefined) data.label = validateLabel(patch.label);
    if (patch.labelEn !== undefined) {
        // Empty labelEn resets to the (possibly updated) label — labelEn is NOT NULL.
        const raw = typeof patch.labelEn === "string" ? patch.labelEn.trim() : "";
        data.labelEn = raw.length > 0 ? raw : (data.label ?? undefined);
    }
    if (patch.emoji !== undefined) data.emoji = validateEmoji(patch.emoji);
    if (patch.iconName !== undefined) data.icon = validateIcon(patch.iconName);
    if (patch.hex !== undefined) data.hex = validateHex(patch.hex);

    // If labelEn was requested-empty but no new label given, keep it non-null by
    // reusing the current label.
    if (patch.labelEn !== undefined && data.labelEn === undefined) {
        const current = await prisma.category.findUnique({ where: { id }, select: { label: true } });
        data.labelEn = current?.label ?? "";
    }

    if (Object.keys(data).length === 0) {
        throw new CategoryError(400, "NOTHING_TO_UPDATE", "Nada que actualizar");
    }

    return prisma.category.update({ where: { id }, data });
}

/**
 * Reorder the CUSTOM categories of a scope. `orderedIds` is the desired order of
 * this scope's custom rows; system rows are not reorderable in V1 (decision #2).
 * Every id must be an editable in-scope custom category. Persisted in one
 * transaction so a partial reorder can't leave inconsistent sortOrders.
 */
export async function reorderCategoriesForScope(scope: CategoryWriteScope, orderedIds: string[]) {
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
        throw new CategoryError(400, "INVALID_ORDER", "Orden no válido");
    }
    const custom = await prisma.category.findMany({
        where: scopeWhere(scope),
        select: { id: true },
    });
    const customIds = new Set(custom.map((c) => c.id));
    if (orderedIds.length !== customIds.size || orderedIds.some((id) => !customIds.has(id))) {
        throw new CategoryError(400, "INVALID_ORDER", "El orden debe incluir exactamente las categorías del contexto");
    }

    await prisma.$transaction(
        orderedIds.map((id, i) =>
            prisma.category.update({ where: { id }, data: { sortOrder: i + 1 } }),
        ),
    );
    return { reordered: orderedIds.length };
}

/**
 * Delete a custom category, REASSIGNING all its references to `reassignToId`
 * (decision #7: an explicit target is mandatory — no orphan, no silent 'other').
 *
 * In one transaction: repoint Expense + RecurringSeries + Budget, then delete.
 * A Budget unique collision (a target budget already exists for the same
 * period/scope) ABORTS with 409 (decision #3) — amounts are never summed or
 * overwritten silently.
 */
export async function deleteCategoryForScope(
    scope: CategoryWriteScope,
    id: string,
    reassignToId: unknown,
) {
    const cat = await loadEditable(prisma, scope, id);

    if (typeof reassignToId !== "string" || reassignToId.length === 0) {
        throw new CategoryError(400, "REASSIGN_REQUIRED", "Debes elegir una categoría destino");
    }
    if (reassignToId === id) {
        throw new CategoryError(400, "REASSIGN_SELF", "La categoría destino no puede ser la que borras");
    }

    const target = await prisma.category.findUnique({ where: { id: reassignToId } });
    if (!target) {
        throw new CategoryError(404, "TARGET_NOT_FOUND", "La categoría destino no existe");
    }
    // Target must be visible in the same context: a system row, or a custom of
    // this same scope.
    const isSystemRow = target.isSystem && target.groupId === null && target.ownerId === null;
    const inScope = scope.kind === "group"
        ? target.groupId === scope.groupId
        : target.ownerId === scope.ownerId;
    if (!isSystemRow && !inScope) {
        throw new CategoryError(400, "TARGET_OUT_OF_SCOPE", "La categoría destino no es válida en este contexto");
    }

    // Pre-check Budget uniqueness so a collision is a clean 409 instead of an
    // opaque P2002 mid-transaction. Each budget currently on the deleted category
    // would move to (target, periodStart, scope) — reject if that slot is taken.
    const budgetsToMove = await prisma.budget.findMany({
        where: { categoryId: id },
        select: { id: true, periodStart: true, coupleId: true, ownerId: true },
    });
    for (const b of budgetsToMove) {
        const clash = await prisma.budget.findFirst({
            where: {
                categoryId: target.id,
                periodStart: b.periodStart,
                coupleId: b.coupleId,
                ownerId: b.ownerId,
            },
            select: { id: true },
        });
        if (clash) {
            throw new CategoryError(
                409,
                "BUDGET_CONFLICT",
                "La categoría destino ya tiene un presupuesto en el mismo periodo. Resuélvelo antes de borrar.",
            );
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.expense.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } });
        await tx.recurringSeries.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } });
        await tx.budget.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } });
        await tx.category.delete({ where: { id } });
    });

    return { deleted: id, reassignedTo: target.id, key: cat.key };
}
