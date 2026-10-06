import Link from "next/link";

/** 404 (EQUIL). Plain, calm copy; one way out. */
export default function NotFound() {
    return (
        <div className="min-h-dvh flex flex-col eq-in px-6 pt-12 pb-[calc(34px+env(safe-area-inset-bottom))]">
            <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
            <p className="mt-6 font-mono text-sm text-muted-foreground">Error 404</p>
            <h1 className="mt-1.5 text-[32px] font-bold tracking-[-0.03em] leading-[1.08] text-pretty">
                Esta página no existe
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45] text-pretty">
                Puede que el enlace esté mal escrito o que la página ya no esté disponible.
            </p>
            <div className="mt-auto pt-10">
                <Link
                    href="/dashboard"
                    className="w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center transition-transform active:scale-[0.98]"
                >
                    Volver a Inicio
                </Link>
            </div>
        </div>
    );
}
