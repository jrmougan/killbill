import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WelcomeClient } from "./welcome-client";

/**
 * Optional first-run onboarding (Fase 3). Presents the three ways to use EQUIL —
 * solo, a new shared space, or joining via an invite link — and is always
 * skippable. Not a wall: nothing here is required to reach the dashboard.
 *
 * A guest session never onboards (it is caged to its space), so it is bounced to
 * its dashboard; anonymous visitors go to login.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    if (session.kind === "guest") redirect("/dashboard");

    return <WelcomeClient />;
}
