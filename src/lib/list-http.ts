import { NextResponse } from "next/server";
import { ListError } from "./list-crud";

/** Map a thrown ListError to a JSON response; anything else → 500. Shared by every list route. */
export function listErrorResponse(e: unknown) {
    if (e instanceof ListError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Shopping list error:", e);
    return NextResponse.json({ error: "Error en las listas" }, { status: 500 });
}
