import Link from "next/link";
import { EqHeader } from "@/components/ui/eq";
import { SpaceActionTiles } from "@/components/space/space-action-tiles";

/**
 * Coherent empty state for group-scoped pages (analytics, settle, …) when the
 * user has no shared space. A solo user is never blocked — the "wall" is an
 * OPTIONAL invitation to create a space or join one with an invite link.
 *
 * `variant` is kept for API compatibility: "invite" and "wall" both offer the
 * create/join tiles; "wall" also offers a way back to Inicio.
 */
export function NoGroupState({
    title,
    variant = "wall",
}: {
    title?: string;
    variant?: "wall" | "invite";
}) {
    return (
        <div className="min-h-screen pb-28 eq-in">
            <EqHeader title={title ?? "Espacio compartido"} back="/dashboard" className="pt-4" />
            <div className="px-5 pt-8 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                    <span className="text-[28px]" aria-hidden="true">🤝</span>
                    <h2 className="text-xl font-bold tracking-[-0.02em]">Aún no compartes gastos con nadie</h2>
                    <p className="text-[15px] text-muted-foreground leading-[1.45]">
                        Esta sección es para gastos compartidos. Crea un espacio (pareja, piso o amigos) o únete con un enlace de invitación.
                    </p>
                </div>
                <SpaceActionTiles />
                {variant === "wall" && (
                    <Link href="/dashboard" className="self-center text-sm font-semibold text-primary py-1.5">
                        Volver a Inicio
                    </Link>
                )}
            </div>
        </div>
    );
}
