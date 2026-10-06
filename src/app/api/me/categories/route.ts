import { NextResponse } from "next/server";
import { getEffectiveCategories } from "@/lib/category-db";
import {
    createCategoryForScope,
    updateCategoryForScope,
    deleteCategoryForScope,
    reorderCategoriesForScope,
    type CategoryWriteScope,
} from "@/lib/category-crud";
import { badRequest, route } from "@/lib/http";
import {
    CATEGORY_ID_REQUIRED,
    CategoryCreateBody,
    CategoryDeleteQuery,
    CategoryPatchBody,
} from "@/lib/category-schemas";

/**
 * Personal category CRUD (Fase 3) — the INDIVIDUAL-mode home for categories
 * (no Couple row, so scoped by `ownerId`). Authorized solely by the session
 * (`getSessionCtx`); there is no space writability gate.
 *
 * Mirrors the space route's operations: GET = MERGE (system ∪ personal) with an
 * `editable` flag; POST/PATCH/DELETE own the caller's personal categories only.
 * CategoryError → `{ error, code }` with its status (mapped by route()).
 */

// Historical contract: any revalidated session (no guest gate here; the proxy
// keeps guests out of /api/me/**) and a 401 "Unauthorized".
const OPTS = {
    auth: "user-or-guest",
    unauthorizedMessage: "Unauthorized",
    errorMessage: "Error en categorías",
    logLabel: "Personal category CRUD error:",
} as const;

const ownerScope = (ownerId: string): CategoryWriteScope => ({ kind: "owner", ownerId });

export const GET = route(OPTS, async ({ ctx }) => {
    const merged = await getEffectiveCategories({ ownerId: ctx.userId });
    const categories = merged.map((c) => ({ ...c, editable: !c.isSystem }));
    return NextResponse.json({ categories });
});

export const POST = route({ ...OPTS, body: CategoryCreateBody }, async ({ ctx, body }) => {
    const category = await createCategoryForScope(ownerScope(ctx.userId), body);
    return NextResponse.json({ category }, { status: 201 });
});

export const PATCH = route({ ...OPTS, body: CategoryPatchBody }, async ({ ctx, body }) => {
    const scope = ownerScope(ctx.userId);
    if (Array.isArray(body.order)) {
        const result = await reorderCategoriesForScope(scope, body.order);
        return NextResponse.json(result);
    }
    if (typeof body.id !== "string") throw badRequest(CATEGORY_ID_REQUIRED);
    const category = await updateCategoryForScope(scope, body.id, body);
    return NextResponse.json({ category });
});

export const DELETE = route({ ...OPTS, query: CategoryDeleteQuery }, async ({ ctx, query }) => {
    const result = await deleteCategoryForScope(ownerScope(ctx.userId), query.id, query.reassignTo ?? null);
    return NextResponse.json(result);
});
