"use server";

import { revalidatePath } from "next/cache";
import { checkAdmin, createInviteFor, deleteInvite } from "./admin-data";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const DENIED: AdminActionResult = { ok: false, error: "Acceso denegado" };

/** Create a registration invite. Admin-only, re-checked against the DB on every call. */
export async function createInviteAction(): Promise<AdminActionResult> {
    const admin = await checkAdmin();
    if (admin.status !== "ok") return DENIED;
    try {
        await createInviteFor(admin.userId);
    } catch (error) {
        console.error("Error creating invite:", error);
        return { ok: false, error: "No se pudo crear la invitación" };
    }
    revalidatePath("/admin");
    return { ok: true };
}

/** Delete a registration invite. Admin-only, re-checked against the DB on every call. */
export async function deleteInviteAction(id: string): Promise<AdminActionResult> {
    const admin = await checkAdmin();
    if (admin.status !== "ok") return DENIED;
    if (typeof id !== "string" || !id) return { ok: false, error: "No se pudo eliminar la invitación" };
    try {
        await deleteInvite(id);
    } catch (error) {
        console.error("Error deleting invite:", error);
        return { ok: false, error: "No se pudo eliminar la invitación" };
    }
    revalidatePath("/admin");
    return { ok: true };
}
