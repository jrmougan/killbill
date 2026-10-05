// Pure helpers for personal mode (`?scope=personal`); usable on server and client.

/** `?scope=personal` / `?from=personal` → true. */
export function isPersonalParam(params: Record<string, string | string[] | undefined>): boolean {
    const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    return first(params.scope) === "personal" || first(params.from) === "personal";
}

/** Append `scope=personal` to an in-app href when in personal mode. */
export function withPersonal(href: string, personal: boolean): string {
    if (!personal) return href;
    return `${href}${href.includes("?") ? "&" : "?"}scope=personal`;
}
