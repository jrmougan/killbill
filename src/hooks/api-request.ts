/**
 * Thin JSON wrapper around `fetch` for client-side mutations: never throws,
 * always resolves to a discriminated result with a user-facing (Spanish) error.
 * The error text is the API's `{ error }` when present, else `errorMessage`;
 * a network failure (fetch rejected) yields `networkErrorMessage`.
 */

export type ApiResult<T = unknown> =
    | { ok: true; status: number; data: T }
    /** `status` 0 = the request never reached the server (network error). */
    | { ok: false; status: number; data: Record<string, unknown> | null; error: string };

export type ApiRequestInit = {
    method?: "POST" | "PATCH" | "PUT" | "DELETE" | "GET";
    /** Serialized as JSON (with the Content-Type header) unless it is FormData. */
    body?: unknown;
    /** Fallback message for a non-2xx answer without an `error` field. */
    errorMessage?: string;
    /** Message when the request failed to reach the server. */
    networkErrorMessage?: string;
    signal?: AbortSignal;
};

export const DEFAULT_ERROR = "No se pudo completar la acción";
export const DEFAULT_NETWORK_ERROR = "Sin conexión. Inténtalo de nuevo.";

export async function apiRequest<T = Record<string, unknown>>(url: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
    const { method = "POST", body, errorMessage = DEFAULT_ERROR, networkErrorMessage = DEFAULT_NETWORK_ERROR, signal } = init;
    const requestInit: RequestInit = { method, signal };
    if (body instanceof FormData) {
        requestInit.body = body;
    } else if (body !== undefined) {
        requestInit.headers = { "Content-Type": "application/json" };
        requestInit.body = JSON.stringify(body);
    }

    let res: Response;
    try {
        res = await fetch(url, requestInit);
    } catch {
        return { ok: false, status: 0, data: null, error: networkErrorMessage };
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    const json = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const apiError = typeof json?.error === "string" && json.error ? json.error : null;
    return { ok: false, status: res.status, data: json, error: apiError ?? errorMessage };
}
