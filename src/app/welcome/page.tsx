import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { madridToday } from "@/lib/space-policy";
import { CreateSpaceFlow } from "@/components/space/create-space-flow";

/**
 * Onboarding (prototype `is.welcome`): pick who you share expenses with, or
 * paste an invite link. Never a wall — "Solo yo" opens the personal context
 * without creating anything. Reached after registering and from the Inicio
 * welcome card of a brand-new account.
 *
 * Works with zero spaces (first run, no back arrow) and for someone who already
 * has spaces (create mode, back to Inicio).
 *
 * A guest session never onboards (it is caged to its space), so it is bounced to
 * its dashboard; anonymous visitors go to login.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    if (session.kind === "guest") redirect("/dashboard");

    const hasSpaces =
        (await prisma.membership.count({ where: { userId: session.userId as string, status: "ACTIVE" } })) > 0;

    return (
        <CreateSpaceFlow
            mode={hasSpaces ? "create" : "onboard"}
            backHref={hasSpaces ? "/dashboard" : undefined}
            ephemeralEnabled={ephemeralSpacesEnabled()}
            today={madridToday()}
        />
    );
}
