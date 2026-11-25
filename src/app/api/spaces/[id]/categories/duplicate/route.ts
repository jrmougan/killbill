import { NextResponse } from "next/server";
import { z } from "zod";
import { duplicateCategoryForScope, type CategoryWriteScope } from "@/lib/category-crud";
import { parseJson, requireSpace, route } from "@/lib/http";
import { idParams, jsonObject } from "@/lib/http/schemas";

/**
 * Duplicate a space category (Fase 6). `id` in the path IS the `groupId`. Creates
 * a custom of this space prefilled from an existing SYSTEM or in-scope custom row
 * (`{ sourceId }` in the body). OWNER/ADMIN only, and blocked in SETTLING/ARCHIVED
 * by the default writability gate — same authorization surface as POST.
 * A missing / non-string sourceId is category-crud's 400 SOURCE_REQUIRED.
 */
const DuplicateBody = jsonObject({ sourceId: z.unknown().optional() });

export const POST = route(
    {
        auth: "user",
        params: idParams,
        unauthorizedMessage: "Unauthorized",
        errorMessage: "Error en categorías",
        logLabel: "Category duplicate error:",
    },
    async ({ req, ctx, params: { id } }) => {
        await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"] });
        const { sourceId } = await parseJson(req, DuplicateBody);
        const scope: CategoryWriteScope = { kind: "group", groupId: id };
        const category = await duplicateCategoryForScope(scope, sourceId);
        return NextResponse.json({ category }, { status: 201 });
    },
);
