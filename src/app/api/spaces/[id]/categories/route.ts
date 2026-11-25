import { NextResponse } from "next/server";
import { z } from "zod";
import { getEffectiveCategories } from "@/lib/category-db";
import {
    createCategoryForScope,
    updateCategoryForScope,
    deleteCategoryForScope,
    reorderCategoriesForScope,
    type CategoryWriteScope,
} from "@/lib/category-crud";
import { badRequest, parseJson, requireSpace, route } from "@/lib/http";
import { idParams, jsonObject } from "@/lib/http/schemas";

/**
 * Space-scoped category CRUD (Fase 3). `id` in the path IS the `groupId`.
 *
 * - GET: the MERGE (system ∪ space-custom, custom shadowing by key, ordered by
 *   sortOrder,key) with an `editable` flag (= !isSystem). Any ACTIVE member —
 *   incl. GUEST (read-only) — may read; `allowArchived` so historical spaces
 *   still render their categories.
 * - POST/PATCH/DELETE: OWNER/ADMIN only (requireSpaceAccess roles gate). The
 *   default (allowArchived:false) also blocks writes in SETTLING/ARCHIVED via
 *   assertSpaceWritable. PATCH doubles as reorder when the body carries `order`.
 *
 * Bodies are parsed after the role gate and only checked for shape (a JSON
 * object): the field rules live in category-crud, which throws CategoryError
 * with its machine code (INVALID_LABEL, INVALID_COLOR, RESERVED_KEY…).
 */

const MISSING_ID = "Falta el id de la categoría";
const field = z.unknown().optional();
const CategoryFields = { key: field, label: field, labelEn: field, emoji: field, iconName: field, hex: field };
const CreateCategoryBody = jsonObject(CategoryFields);
/** `{ order: string[] }` (reorder) or `{ id, ...fields }` (single update). */
const PatchCategoryBody = jsonObject({ ...CategoryFields, id: field, order: field });
const DeleteCategoryQuery = z.object({ id: z.string().optional(), reassignTo: z.string().optional() });

const writeOptions = {
    auth: "user",
    params: idParams,
    unauthorizedMessage: "Unauthorized",
    errorMessage: "Error en categorías",
    logLabel: "Category CRUD error:",
} as const;

export const GET = route(
    { ...writeOptions, auth: "user-or-guest" },
    async ({ ctx, params: { id } }) => {
        await requireSpace(ctx, id, { allowArchived: true, allowGuest: true });
        const merged = await getEffectiveCategories({ groupId: id });
        const categories = merged.map((c) => ({ ...c, editable: !c.isSystem }));
        return NextResponse.json({ categories });
    },
);

export const POST = route(writeOptions, async ({ req, ctx, params: { id } }) => {
    await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"] });
    const body = await parseJson(req, CreateCategoryBody);
    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    const category = await createCategoryForScope(scope, body);
    return NextResponse.json({ category }, { status: 201 });
});

export const PATCH = route(writeOptions, async ({ req, ctx, params: { id } }) => {
    await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"] });
    const body = await parseJson(req, PatchCategoryBody);
    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    // Reorder mode: { order: string[] }.
    if (Array.isArray(body.order)) {
        return NextResponse.json(await reorderCategoriesForScope(scope, body.order));
    }
    // Single-update mode: { id, ...fields }.
    if (typeof body.id !== "string") throw badRequest(MISSING_ID);
    const category = await updateCategoryForScope(scope, body.id, body);
    return NextResponse.json({ category });
});

export const DELETE = route(
    { ...writeOptions, query: DeleteCategoryQuery },
    async ({ ctx, params: { id }, query }) => {
        await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"] });
        const scope: CategoryWriteScope = { kind: "group", groupId: id };
        if (!query.id) throw badRequest(MISSING_ID);
        return NextResponse.json(await deleteCategoryForScope(scope, query.id, query.reassignTo ?? null));
    },
);
