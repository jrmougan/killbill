/**
 * Sanitise a user-supplied in-app return path (e.g. `?returnTo=`) so it can
 * never send the browser to another origin. Browsers strip ASCII tab/newline
 * from URLs and treat `\` like `/`, so `/%09/evil.com` or `/\evil.com` would
 * become the protocol-relative `//evil.com`. We resolve against a dummy origin
 * and only accept the result if it stays on that origin.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
    if (!raw || typeof raw !== "string") return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    try {
        const base = "https://app.invalid";
        const url = new URL(raw, base);
        if (url.origin !== base) return null;
        return url.pathname + url.search + url.hash;
    } catch {
        return null;
    }
}
