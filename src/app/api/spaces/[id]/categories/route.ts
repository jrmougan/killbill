import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getEffectiveCategories } from "@/lib/category-db";
import {
    createCategoryForScope,
    updateCategoryForScope,
    deleteCategoryForScope,
    reorderCategoriesForScope,
    CategoryError,
    type CategoryWriteScope,
} from "@/lib/category-crud";

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
 */

function errorResponse(e: unknown) {
    if (e instanceof CategoryError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Category CRUD error:", e);
    return NextResponse.json({ error: "Error en categorías" }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { allowArchived: true, allowGuest: true });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const merged = await getEffectiveCategories({ groupId: id });
    const categories = merged.map((c) => ({ ...c, editable: !c.isSystem }));
    return NextResponse.json({ categories });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"] });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const category = await createCategoryForScope(scope, body);
        return NextResponse.json({ category }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"] });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        // Reorder mode: { order: string[] }.
        if (Array.isArray(body?.order)) {
            const result = await reorderCategoriesForScope(scope, body.order);
            return NextResponse.json(result);
        }
        // Single-update mode: { id, ...fields }.
        if (typeof body?.id !== "string") {
            return NextResponse.json({ error: "Falta el id de la categoría" }, { status: 400 });
        }
        const category = await updateCategoryForScope(scope, body.id, body);
        return NextResponse.json({ category });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"] });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    const { searchParams } = new URL(request.url);
    const catId = searchParams.get("id");
    const reassignTo = searchParams.get("reassignTo");
    if (!catId) return NextResponse.json({ error: "Falta el id de la categoría" }, { status: 400 });
    try {
        const result = await deleteCategoryForScope(scope, catId, reassignTo);
        return NextResponse.json(result);
    } catch (e) {
        return errorResponse(e);
    }
}
