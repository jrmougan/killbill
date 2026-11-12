import { redirect } from "next/navigation";
import { getAiSettingsView } from "@/lib/ai-settings";
import { AdminForbidden } from "../admin-forbidden";
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

    if (admin.status === "forbidden") return <AdminForbidden />;

    return <AiSettingsForm settings={await getAiSettingsView()} />;
}
