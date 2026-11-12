import Link from "next/link";

/**
 * What a signed-in non-admin sees on any /admin page. Each page still calls
 * `checkAdmin()` itself and renders this: a layout would not re-run the check
 * on client navigation.
 */
export function AdminForbidden() {
    return (
        <div className="min-h-dvh flex flex-col eq-in px-6 pt-12 pb-10">
            <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
            <h1 className="mt-3.5 text-[32px] font-bold tracking-[-0.03em] leading-[1.08]">Solo administración</h1>
            <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45]">
                No tienes permisos de administrador para ver esta página.
            </p>
            <div className="mt-auto pt-8">
                <Link
                    href="/dashboard"
                    className="w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center"
                >
                    Ir a Inicio
                </Link>
            </div>
        </div>
    );
}
