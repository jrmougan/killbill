"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { takeFlashToast } from "@/lib/flash-toast";

/**
 * Shows the toast left by `setFlashToast` before navigating here (once).
 * Re-checks on every pathname change: it lives in tab layouts, which stay
 * mounted when navigating inside the same segment (/lists/a → /lists).
 */
export function FlashToast() {
    const pathname = usePathname();
    const [toast, show, action] = useEqToast(3000);

    useEffect(() => {
        const flash = takeFlashToast();
        if (flash) show(flash.message, flash.action);
    }, [pathname, show]);

    return toast ? <EqToast action={action}>{toast}</EqToast> : null;
}
