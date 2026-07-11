"use client";

import { useState, useEffect, useCallback } from "react";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
} from "@/lib/category-context";

interface UseCategoryListResult {
    categories: CategoryListItem[];
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/**
 * Fetch the effective (merged) category set for a context (Fase 4). One place
 * for the loading/empty/error states the pickers, filters and budget all need,
 * so no view re-implements the fetch. `initial` seeds the list from the server
 * (SSR) to avoid a first-paint flash.
 */
export function useCategoryList(
    context: CategoryContext,
    initial?: CategoryListItem[],
): UseCategoryListResult {
    const [categories, setCategories] = useState<CategoryListItem[]>(initial ?? []);
    const [loading, setLoading] = useState(!initial);
    const [error, setError] = useState<string | null>(null);

    const endpoint = categoriesEndpoint(context);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(endpoint);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setCategories(Array.isArray(json.categories) ? json.categories : []);
        } catch (e) {
            console.error("Failed to load categories", e);
            setError("No se pudieron cargar las categorías");
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        load();
    }, [load]);

    return { categories, loading, error, reload: load };
}
