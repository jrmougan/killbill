import { NextResponse } from "next/server";
import { duplicateCategoryForScope } from "@/lib/category-crud";
import { route } from "@/lib/http";
import { CategoryDuplicateBody } from "@/lib/category-schemas";

/**
 * Duplicate a personal category (Fase 6). Creates a personal custom (ownerId =
 * caller) prefilled from an existing SYSTEM or in-scope personal row
 * (`{ sourceId }` in the body). Authorized solely by the session (any
 * revalidated session, as before; 401 "Unauthorized").
 */
export const POST = route(
    {
        auth: "user-or-guest",
        unauthorizedMessage: "Unauthorized",
        body: CategoryDuplicateBody,
        errorMessage: "Error en categorías",
        logLabel: "Personal category duplicate error:",
    },
    async ({ ctx, body }) => {
        const category = await duplicateCategoryForScope({ kind: "owner", ownerId: ctx.userId }, body.sourceId);
        return NextResponse.json({ category }, { status: 201 });
    },
);
