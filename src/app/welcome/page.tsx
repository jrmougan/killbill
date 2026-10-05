import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { CreateSpaceFlow } from "@/components/space/create-space-flow";

/**
 * Optional first-run onboarding (prototype `is.welcome`): pick who you share
 * expenses with, or paste an invite link. Never a wall — "Solo yo" opens the
 * personal context without creating anything.
 *
 * A guest session never onboards (it is caged to its space), so it is bounced to
 * its dashboard; anonymous visitors go to login.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    if (session.kind === "guest") redirect("/dashboard");

    return <CreateSpaceFlow mode="onboard" ephemeralEnabled={ephemeralSpacesEnabled()} />;
}
