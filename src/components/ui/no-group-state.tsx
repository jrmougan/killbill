import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

/**
 * Coherent empty state for group-scoped pages (analytics, settle, tags, ...) when
 * the user has no group. Fase 1 (decouple): a solo user is never blocked — the
 * "wall" becomes an OPTIONAL invitation to create/join a space.
 *
 * `variant`:
 *  - "wall" (default): informative empty state with a way back to Inicio.
 *  - "invite": foregrounds "Crear un espacio" (for surfaces that benefit from the CTA).
 */
export function NoGroupState({
    title,
    variant = "wall",
}: {
    title?: string;
    variant?: "wall" | "invite";
}) {
    return (
        <div className="flex flex-col min-h-screen p-4 pb-24 items-center justify-center">
            <GlassCard className="text-center py-10 px-6 space-y-4 max-w-sm w-full">
                <Users className="h-12 w-12 text-muted-foreground mx-auto" />
                <div className="space-y-1.5">
                    <h2 className="text-lg font-bold text-foreground">{title ?? "Aún no tienes un espacio compartido"}</h2>
                    <p className="text-sm text-muted-foreground">
                        Esta sección es para gastos compartidos. Crea un espacio (pareja, grupo o viaje) o únete a uno para empezar.
                    </p>
                </div>
                {variant === "invite" ? (
                    <div className="space-y-2">
                        <Link href="/spaces/new">
                            <Button size="sm" className="w-full gap-2">
                                <Plus className="h-4 w-4" /> Crear un espacio
                            </Button>
                        </Link>
                        <Link href="/dashboard">
                            <Button variant="ghost" size="sm" className="w-full">Volver a Inicio</Button>
                        </Link>
                    </div>
                ) : (
                    <Link href="/dashboard">
                        <Button variant="secondary" size="sm" className="w-full">Ir a Inicio</Button>
                    </Link>
                )}
            </GlassCard>
        </div>
    );
}
