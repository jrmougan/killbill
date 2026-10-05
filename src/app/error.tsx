"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { EqCta } from "@/components/ui/eq";

/** Route error boundary (EQUIL). Retry first; Inicio as the way out. */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="min-h-dvh flex flex-col eq-in px-6 pt-12 pb-[calc(34px+env(safe-area-inset-bottom))]">
            <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
            <h1 className="mt-6 text-[32px] font-bold tracking-[-0.03em] leading-[1.08] text-pretty">Algo ha fallado</h1>
            <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45] text-pretty">
                No hemos podido cargar esta pantalla. Tus datos están a salvo: vuelve a intentarlo.
            </p>
            {error.digest && (
                <p className="mt-4 font-mono text-xs text-muted-foreground">Referencia: {error.digest}</p>
            )}
            <div className="mt-auto pt-10 flex flex-col items-center gap-3.5">
                <EqCta onClick={reset}>
                    <RotateCw className="h-4 w-4" aria-hidden="true" /> Reintentar
                </EqCta>
                <Link href="/dashboard" className="text-sm font-semibold text-primary px-2 py-2">
                    Ir a Inicio
                </Link>
            </div>
        </div>
    );
}
