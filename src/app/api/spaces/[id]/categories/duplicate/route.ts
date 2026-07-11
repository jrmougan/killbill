import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import {
    duplicateCategoryForScope,
    CategoryError,
    type CategoryWriteScope,
} from "@/lib/category-crud";

/**
 * Duplicate a space category (Fase 6). `id` in the path IS the `groupId`. Creates
 * a custom of this space prefilled from an existing SYSTEM or in-scope custom row
 * (`{ sourceId }` in the body). OWNER/ADMIN only, and blocked in SETTLING/ARCHIVED
 * by the default writability gate — same authorization surface as POST.
 */
function errorResponse(e: unknown) {
    if (e instanceof CategoryError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Category duplicate error:", e);
    return NextResponse.json({ error: "Error en categorías" }, { status: 500 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    const auth = await requireSpaceAccess(ctx, id, { roles: ["OWNER", "ADMIN"] });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    const scope: CategoryWriteScope = { kind: "group", groupId: id };
    try {
        const body = await request.json();
        const category = await duplicateCategoryForScope(scope, body?.sourceId);
        return NextResponse.json({ category }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}
