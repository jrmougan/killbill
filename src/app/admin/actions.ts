"use server";

import { revalidatePath } from "next/cache";
import { checkAdmin, createInviteFor, deleteInvite } from "./admin-data";

/** `gone`: the invite was already used or voided, so there is nothing left to retry. */
export type AdminActionResult = { ok: true } | { ok: false; error: string; gone?: true };

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

/**
 * Void an unused registration invite. Admin-only, re-checked against the DB on
 * every call. An invite that was used or voided meanwhile is not an error to
 * retry: the list is revalidated and the result says `gone`.
 */
export async function deleteInviteAction(id: string): Promise<AdminActionResult> {
    const admin = await checkAdmin();
    if (admin.status !== "ok") return DENIED;
    if (typeof id !== "string" || !id) return { ok: false, error: "No se pudo eliminar la invitación" };
    let deleted: boolean;
    try {
        deleted = await deleteInvite(id);
    } catch (error) {
        console.error("Error deleting invite:", error);
        return { ok: false, error: "No se pudo eliminar la invitación" };
    }
    revalidatePath("/admin");
    if (!deleted) return { ok: false, error: "Esta invitación ya se había usado o anulado", gone: true };
    return { ok: true };
}
