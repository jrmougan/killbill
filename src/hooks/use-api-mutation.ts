"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, type ApiRequestInit, type ApiResult } from "./api-request";

export type MutateInit = ApiRequestInit & {
    /** Refresh the RSC tree on success (default: the hook's `refresh` option). */
    refresh?: boolean;
};

/**
 * The shared "fetch('/api…') → show the error or router.refresh()" mutation
 * pattern. Tracks the in-flight request (`pending`) and the follow-up refresh
 * (`refreshing`, a transition) separately; `busy` is either. A failed call sets
 * `error` and, when given, calls `onError` (e.g. a toast). Returns the result so
 * callers can branch on specific statuses/codes.
 */
export function useApiMutation(options: { refresh?: boolean; onError?: (message: string) => void } = {}) {
    const { refresh: refreshByDefault = true, onError } = options;
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mutate = useCallback(
        async <T = Record<string, unknown>>(url: string, init: MutateInit = {}): Promise<ApiResult<T>> => {
            const { refresh = refreshByDefault, ...requestInit } = init;
            setPending(true);
            setError(null);
            const result = await apiRequest<T>(url, requestInit);
            setPending(false);
            if (result.ok) {
                if (refresh) startTransition(() => router.refresh());
            } else {
                setError(result.error);
                onError?.(result.error);
            }
            return result;
        },
        [refreshByDefault, onError, router],
    );

    return { mutate, pending, refreshing, busy: pending || refreshing, error, setError };
}
