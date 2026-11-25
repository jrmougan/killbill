"use client";

import { useRouter } from "next/navigation";
import { EqHeader } from "@/components/ui/eq";
import React from "react";

/**
 * EqHeader whose back arrow returns to the previous screen (the settlement may be
 * opened from Gastos, Inicio or the history), falling back to `fallback` when
 * the page was opened directly.
 */
export function SettleHeader({
    fallback,
    title,
    children,
}: {
    fallback: string;
    title?: React.ReactNode;
    children?: React.ReactNode;
}) {
    const router = useRouter();
    const onBack = () => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
    };
    return (
        <EqHeader onBack={onBack} title={title}>
            {children}
        </EqHeader>
    );
}
