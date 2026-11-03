import Link from "next/link";
import { redirect } from "next/navigation";
import { getAiSettingsView } from "@/lib/ai-settings";
import { checkAdmin } from "../admin-data";
import { AiSettingsForm } from "./ai-settings-form";

/**
 * Instance-wide OCR provider keys and models. The admin role is re-checked against
 * the DB here (the proxy only guarantees a session) and again by the API route.
 * The view carries the source and last-4 hint of each key, never the key itself.
 */
export default async function AdminAiPage() {
    const admin = await checkAdmin();
    if (admin.status === "unauthenticated") redirect("/login");

    if (admin.status === "forbidden") {
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

    return <AiSettingsForm settings={await getAiSettingsView()} />;
}
