// Shared "scope lens" type + normalizer, usable from both server and client
// components (kept out of the "use client" module so the server can call it).
export type Scope = "todo" | "comun" | "personal";

export function normalizeScope(raw: string | string[] | undefined): Scope {
    const v = Array.isArray(raw) ? raw[0] : raw;
    return v === "comun" || v === "personal" ? v : "todo";
}
