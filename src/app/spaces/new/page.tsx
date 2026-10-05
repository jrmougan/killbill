import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { madridToday } from "@/lib/space-policy";
import { CreateSpaceFlow } from "@/components/space/create-space-flow";

export const dynamic = "force-dynamic";

/** "Crear espacio" — same chooser as the onboarding, reached from Espacios. */
export default async function NewSpacePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    if (session.kind === "guest") redirect("/dashboard");
    return <CreateSpaceFlow mode="create" backHref="/spaces" ephemeralEnabled={ephemeralSpacesEnabled()} today={madridToday()} />;
}
