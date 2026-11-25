/**
 * One-shot toast that survives a navigation ("Espacio archivado" after the
 * redirect to /spaces). The writer calls `setFlashToast` right before
 * navigating; `<FlashToast/>` on the target page calls `takeFlashToast` once.
 * Stored in sessionStorage, so it stays in this tab. Storage can throw
 * (private mode, disabled storage, SSR): every access is guarded and a
 * failure simply means no toast — never a broken page.
 */

const KEY = "eq-flash-toast";

export type FlashToastData = { message: string; action?: { label: string; href: string } };

function storage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

export function setFlashToast(message: string, action?: { label: string; href: string }): void {
    try {
        storage()?.setItem(KEY, JSON.stringify(action ? { message, action } : { message }));
    } catch {
        // Quota or disabled storage: the toast is a nicety, drop it.
    }
}

/** Reads and clears the pending toast (null if none, unreadable or malformed). */
export function takeFlashToast(): FlashToastData | null {
    try {
        const s = storage();
        const raw = s?.getItem(KEY);
        if (!raw) return null;
        s?.removeItem(KEY);
        const data = JSON.parse(raw) as Partial<FlashToastData> | null;
        if (!data || typeof data.message !== "string" || !data.message) return null;
        const a = data.action;
        return a && typeof a.label === "string" && typeof a.href === "string" && a.href.startsWith("/")
            ? { message: data.message, action: { label: a.label, href: a.href } }
            : { message: data.message };
    } catch {
        return null;
    }
}
