import Link from "next/link";
import { redirect } from "next/navigation";
import { checkAdmin, listInvites } from "./admin-data";
import { AdminInvites } from "./admin-invites";

/**
 * Admin panel (EQUIL): registration invitation codes. These are the ADMIN
 * `InviteCode`s that gate account creation (the instance is closed) — not space
 * invitations, which are 256-bit `/i/<token>` links.
 *
 * Loaded on the server: the admin role is re-checked against the DB here (the
 * proxy only guarantees a session) and again in every Server Action.
 */
export default async function AdminPage() {
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

    return <AdminInvites invites={await listInvites()} />;
}
