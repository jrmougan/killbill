import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
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
 * Personal category CRUD (Fase 3) — the INDIVIDUAL-mode home for categories
 * (no Couple row, so scoped by `ownerId`). Authorized solely by the session
 * (`getSessionCtx`); there is no space writability gate.
 *
 * Mirrors the space route's operations: GET = MERGE (system ∪ personal) with an
 * `editable` flag; POST/PATCH/DELETE own the caller's personal categories only.
 */

function errorResponse(e: unknown) {
    if (e instanceof CategoryError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Personal category CRUD error:", e);
    return NextResponse.json({ error: "Error en categorías" }, { status: 500 });
}

export async function GET() {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const merged = await getEffectiveCategories({ ownerId: ctx.userId });
    const categories = merged.map((c) => ({ ...c, editable: !c.isSystem }));
    return NextResponse.json({ categories });
}

export async function POST(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const scope: CategoryWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const category = await createCategoryForScope(scope, body);
        return NextResponse.json({ category }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function PATCH(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const scope: CategoryWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        if (Array.isArray(body?.order)) {
            const result = await reorderCategoriesForScope(scope, body.order);
            return NextResponse.json(result);
        }
        if (typeof body?.id !== "string") {
            return NextResponse.json({ error: "Falta el id de la categoría" }, { status: 400 });
        }
        const category = await updateCategoryForScope(scope, body.id, body);
        return NextResponse.json({ category });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const scope: CategoryWriteScope = { kind: "owner", ownerId: ctx.userId };
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
