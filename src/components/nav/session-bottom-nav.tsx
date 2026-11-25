import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { BottomNav } from "./bottom-nav";

/**
 * Bottom nav for the tab destinations (Inicio, Gastos, Mes, Listas), adapted to
 * a GUEST session (reduced tabs). Rendered from those segments' layouts — not
 * the root layout — so reading the session cookie only makes the
 * authenticated routes dynamic and public pages (login, register…) can be
 * prerendered. Cheap: just verifies the JWT, no DB round-trip.
 */
export async function SessionBottomNav() {
    const session = await getSession();
    return (
        // useSearchParams() inside the nav needs a Suspense boundary.
        <Suspense fallback={null}>
            <BottomNav isGuest={session?.kind === "guest"} />
        </Suspense>
    );
}

/** Layout body shared by the tab segments: the page plus the session-aware nav. */
export function WithBottomNav({ children }: { children: React.ReactNode }) {
    return (
        <>
            {children}
            <SessionBottomNav />
        </>
    );
}
