import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/authz";
import {
    duplicateCategoryForScope,
    CategoryError,
    type CategoryWriteScope,
} from "@/lib/category-crud";

/**
 * Duplicate a personal category (Fase 6). Creates a personal custom (ownerId =
 * caller) prefilled from an existing SYSTEM or in-scope personal row
 * (`{ sourceId }` in the body). Authorized solely by the session.
 */
function errorResponse(e: unknown) {
    if (e instanceof CategoryError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Personal category duplicate error:", e);
    return NextResponse.json({ error: "Error en categorías" }, { status: 500 });
}

export async function POST(request: Request) {
    const ctx = await getSessionCtx();
    if (!ctx?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const scope: CategoryWriteScope = { kind: "owner", ownerId: ctx.userId };
    try {
        const body = await request.json();
        const category = await duplicateCategoryForScope(scope, body?.sourceId);
        return NextResponse.json({ category }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}
