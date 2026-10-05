"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { formatCurrency } from "@/lib/currency";

/**
 * "Gasto guardado · 43,85 €" confirmation after /expenses/new redirects to
 * `/dashboard?saved=<cents>`. Shows once, then strips `saved` from the URL
 * (keeping `scope`) so a reload or back-navigation does not repeat it.
 */
export function SavedToast() {
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [toast, show] = useEqToast(2500);
    const saved = params.get("saved");

    useEffect(() => {
        if (saved === null) return;
        const cents = Number(saved);
        show(Number.isFinite(cents) && cents > 0 ? `Gasto guardado · ${formatCurrency(cents)}` : "Gasto guardado");
        const next = new URLSearchParams(params.toString());
        next.delete("saved");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, [saved, params, pathname, router, show]);

    return toast ? <EqToast>{toast}</EqToast> : null;
}
