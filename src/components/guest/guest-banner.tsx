import Link from "next/link";
import { UserPlus } from "lucide-react";

/**
 * Guest-session banner (Fase 3). Rendered on the surfaces a guest can reach
 * (dashboard, expenses list, settle) to make the temporary nature of a
 * shadow-user session explicit and offer the one-tap upgrade to a real account.
 *
 * Deliberately directive-free (no "use client", no server-only APIs) so it can
 * be dropped into both server components (dashboard) and client components
 * (settle/list clients) alike. It renders nothing unless `show` is true, so
 * callers can mount it unconditionally: `<GuestBanner show={isGuest} />`.
 */
export function GuestBanner({ show = true }: { show?: boolean }) {
    if (!show) return null;
    return (
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--accent-tint)] border border-[color:var(--accent-border)] px-4 py-3">
            <UserPlus className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">Estás como invitado</p>
                <p className="text-[12px] text-muted-foreground">
                    Sesión temporal. Crea una cuenta para no perder el acceso.
                </p>
            </div>
            <Link
                href="/guest/upgrade"
                className="shrink-0 text-[12px] font-semibold text-primary hover:underline"
            >
                Crear cuenta →
            </Link>
        </div>
    );
}
