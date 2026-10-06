import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { SetupForm } from "./setup-form";

/**
 * First-run setup: create the first admin. Same rule as GET /api/setup — only
 * available while the instance has no users — resolved on the server for each
 * request (no client-side check + spinner). The form still posts to
 * /api/setup, which re-checks the rule atomically before creating the admin.
 */
export default async function SetupPage() {
    await connection(); // the user count is per-request, never prerendered
    const setupRequired = (await prisma.user.count()) === 0;

    if (!setupRequired) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-4">
                <div className="text-6xl">✅</div>
                <h1 className="text-2xl font-bold">Setup completado</h1>
                <p className="text-muted-foreground text-center">
                    La aplicación ya está configurada.<br />
                    Inicia sesión para continuar.
                </p>
                <Link
                    href="/login"
                    className="w-full max-w-xs h-14 rounded-[18px] text-base font-semibold flex items-center justify-center gap-2 transition-transform active:scale-[0.98] bg-primary text-primary-foreground"
                >
                    Ir a Login
                </Link>
            </div>
        );
    }

    return <SetupForm />;
}
