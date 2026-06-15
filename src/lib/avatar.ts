/**
 * Returns true when an avatar value is an uploaded image URL
 * (e.g. "/uploads/..." or "http(s)://...") rather than an emoji/initial.
 */
export function isAvatarUrl(value: string | null | undefined): value is string {
    if (!value) return false;
    return value.startsWith("/") || value.startsWith("http");
}
