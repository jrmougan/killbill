import Link from "next/link";
import { Users } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

/**
 * Coherent empty state for group-scoped pages (analytics, settle, tags, ...) when
 * the user has no group. Phase 1 (decouple): a solo user is never blocked/redirected
 * — these pages simply show this instead of shared data, with a path to opt into a group.
 */
export function NoGroupState({ title }: { title?: string }) {
    return (
        <div className="flex flex-col min-h-screen p-4 pb-24 items-center justify-center">
            <GlassCard className="text-center py-10 px-6 space-y-4 max-w-sm w-full">
                <Users className="h-12 w-12 text-muted-foreground mx-auto" />
                <div className="space-y-1.5">
                    <h2 className="text-lg font-bold text-foreground">{title ?? "Solo para grupos"}</h2>
                    <p className="text-sm text-muted-foreground">
                        Esta sección es para gastos compartidos. Crea un grupo o únete a uno desde Inicio para empezar.
                    </p>
                </div>
                <Link href="/dashboard">
                    <Button variant="secondary" size="sm" className="w-full">Ir a Inicio</Button>
                </Link>
            </GlassCard>
        </div>
    );
}
