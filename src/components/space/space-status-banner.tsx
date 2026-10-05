import Link from "next/link";
import { Lock, Clock, Hourglass } from "lucide-react";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

/**
 * Contextual banner for a space's lifecycle state. Rendered on Inicio and the
 * space management page:
 *  - SETTLING → "cerrando cuentas": a link to settle THIS space for everyone
 *    (`settleHref`, i.e. /settle?space=<id>) and the close flow for OWNER/ADMIN.
 *  - ARCHIVED → read-only "recuerdo".
 *  - EPHEMERAL + expiresAt (while ACTIVE) → trip end. The space is never closed
 *    automatically, but guest access ends with that day (their session is capped
 *    at `expiresAt`), so the copy says exactly that.
 *
 * Returns null when there is nothing to say (an ACTIVE non-ephemeral space).
 */
export function SpaceStatusBanner({
    spaceId,
    type,
    status,
    expiresAt,
    canManage = false,
    settleHref,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    expiresAt?: Date | string | null;
    /** OWNER/ADMIN see the close CTA. */
    canManage?: boolean;
    /** Where to settle this space (SETTLING). Omit to hide the link. */
    settleHref?: string;
}) {
    if (status === SpaceStatus.ARCHIVED) {
        return (
            <div data-testid="space-status-banner" data-status={status} className="flex items-center gap-3 rounded-2xl bg-[var(--track)] px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">Espacio archivado</p>
                    <p className="text-[12px] text-muted-foreground">Solo lectura — un recuerdo de lo compartido.</p>
                </div>
            </div>
        );
    }

    if (status === SpaceStatus.SETTLING) {
        return (
            <div data-testid="space-status-banner" data-status={status} className="flex items-start gap-3 rounded-2xl bg-[var(--accent-tint)] border border-[color:var(--accent-border)] px-4 py-3">
                <Clock className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">Cerrando cuentas</p>
                    <p className="text-[12px] text-muted-foreground">No se pueden crear gastos nuevos; solo liquidar.</p>
                    {(settleHref || canManage) && (
                        <div className="flex flex-wrap gap-x-4 -mb-2">
                            {settleHref && (
                                <Link
                                    href={settleHref}
                                    data-testid="space-status-settle-link"
                                    className="min-h-11 flex items-center text-[13px] font-semibold text-primary"
                                >
                                    Ir a liquidar →
                                </Link>
                            )}
                            {canManage && (
                                <Link
                                    href={`/spaces/${spaceId}/close`}
                                    data-testid="space-status-close-link"
                                    className="min-h-11 flex items-center text-[13px] font-semibold text-primary"
                                >
                                    Ver cierre →
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ACTIVE ephemeral with an end date.
    if (type === SpaceType.EPHEMERAL && expiresAt) {
        const days = daysUntil(expiresAt);
        if (days === null) return null;
        const label =
            days < 0 ? "El viaje ya terminó" :
            days <= 1 ? "El viaje termina hoy" :
            `Quedan ${days} días de viaje`;
        return (
            <div data-testid="space-trip-banner" className="flex items-start gap-3 rounded-2xl bg-[var(--track)] px-4 py-3">
                <Hourglass className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{label}</p>
                    <p className="text-[12px] text-muted-foreground">
                        {days < 0
                            ? "Los invitados ya no pueden entrar. El espacio sigue abierto hasta que lo cerréis."
                            : "Los invitados pueden entrar hasta el final de ese día. El espacio no se cierra solo."}
                    </p>
                    {canManage && (
                        <Link
                            href={`/spaces/${spaceId}/close`}
                            className="-mb-2 min-h-11 inline-flex items-center text-[13px] font-semibold text-primary"
                        >
                            Cerrar cuentas →
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    return null;
}
