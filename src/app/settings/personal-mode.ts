"use client";

import { useEffect, useState } from "react";

/**
 * Personal mode (`?scope=personal`) for the screens reached from the avatar
 * (Ajustes → Categorías / Etiquetas / Presupuestos), which do not take the
 * param themselves. Source of truth, in order:
 *   1. an explicit `?scope=personal` (or `?from=personal`) on the URL;
 *   2. the last mode the bottom nav saw on a scoped tab (sessionStorage key
 *      written by components/nav/bottom-nav.tsx).
 * Read after mount so SSR and hydration agree.
 */
const SCOPE_KEY = "eq-scope-personal";

export function usePersonalMode(fromUrl: boolean): boolean {
    const [personal, setPersonal] = useState(fromUrl);
    useEffect(() => {
        if (fromUrl) return;
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
            if (sessionStorage.getItem(SCOPE_KEY) === "1") setPersonal(true);
        } catch {
            /* storage unavailable: stay in the URL's mode */
        }
    }, [fromUrl]);
    return personal;
}
