import { redirect } from "next/navigation";
import { AdminForbidden } from "./admin-forbidden";
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

    if (admin.status === "forbidden") return <AdminForbidden />;

    return <AdminInvites invites={await listInvites()} />;
}
