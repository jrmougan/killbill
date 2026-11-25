import { redirect } from "next/navigation";
import { getSessionCtx } from "@/lib/authz";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { AuthShell } from "@/components/auth/auth-shell";
import { UpgradeForm } from "./upgrade-form";

/**
 * Guest → account upgrade screen (Fase 3). Only a live guest session may reach it;
 * a registered user is bounced to the dashboard, an anonymous visitor to login.
 * It is a tab of the guest nav, so it leaves room for the bottom bar.
 */
export const dynamic = "force-dynamic";

export default async function GuestUpgradePage() {
    if (!ephemeralSpacesEnabled()) redirect("/dashboard");

    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    if (ctx.kind !== "guest") redirect("/dashboard");

    return (
        <AuthShell
            title="Crea tu cuenta"
            subtitle="Conservarás todos tus gastos y saldos de este espacio: solo añadimos un email y una contraseña a lo que ya eres."
            className="pb-[calc(110px+env(safe-area-inset-bottom))]"
        >
            <UpgradeForm />
        </AuthShell>
    );
}
