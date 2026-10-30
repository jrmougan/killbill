"use client";

import { useState, useEffect, useCallback } from "react";
import {
    type CategoryContext,
    type CategoryListItem,
    categoriesEndpoint,
} from "@/lib/category-context";

type FetchResult = { categories: CategoryListItem[] } | { error: string };

async function fetchCategories(endpoint: string): Promise<FetchResult> {
    try {
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { categories: Array.isArray(json.categories) ? json.categories : [] };
    } catch (e) {
        console.error("Failed to load categories", e);
        return { error: "No se pudieron cargar las categorías" };
    }
}

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

    const apply = useCallback((result: FetchResult) => {
        if ("categories" in result) {
            setCategories(result.categories);
            setError(null);
        } else {
            setError(result.error);
        }
        setLoading(false);
    }, []);

    // Manual retry (event handler): show the loading state straight away.
    const reload = useCallback(() => {
        setLoading(true);
        setError(null);
        void fetchCategories(endpoint).then(apply);
    }, [endpoint, apply]);

    // A new context means a new list: back to loading, adjusted while rendering.
    const [loadedFor, setLoadedFor] = useState(endpoint);
    if (loadedFor !== endpoint) {
        setLoadedFor(endpoint);
        setLoading(true);
        setError(null);
    }

    // Sync with the server; a response for a superseded endpoint is dropped.
    useEffect(() => {
        let current = true;
        void fetchCategories(endpoint).then((result) => {
            if (current) apply(result);
        });
        return () => {
            current = false;
        };
    }, [endpoint, apply]);

    return { categories, loading, error, reload };
}
