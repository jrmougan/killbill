import { redirect } from "next/navigation";
import { getSessionCtx } from "@/lib/authz";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { UpgradeForm } from "./upgrade-form";

/**
 * Guest → account upgrade screen (Fase 3). Only a live guest session may reach it;
 * a registered user is bounced to the dashboard, an anonymous visitor to login.
 */
export const dynamic = "force-dynamic";

export default async function GuestUpgradePage() {
    if (!ephemeralSpacesEnabled()) redirect("/dashboard");

    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    if (ctx.kind !== "guest") redirect("/dashboard");

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8 max-w-md mx-auto">
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter text-primary italic">EQUIL</h1>
                <p className="text-muted-foreground">Crea tu cuenta para conservar el acceso</p>
            </div>
            <p className="text-sm text-center text-muted-foreground max-w-xs">
                Conservarás todos tus gastos y saldos de este espacio. Solo añadimos un email y una
                contraseña a lo que ya eres.
            </p>
            <UpgradeForm />
        </div>
    );
}
