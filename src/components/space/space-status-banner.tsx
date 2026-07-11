import Link from "next/link";
import { Lock, Clock, Hourglass } from "lucide-react";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

/**
 * Contextual banner for a space's lifecycle state (Fase 1). Rendered on the
 * dashboard and space-scoped views:
 *  - SETTLING → "cerrando cuentas", CTA to the close flow.
 *  - ARCHIVED → read-only "recuerdo del viaje".
 *  - EPHEMERAL + expiresAt (while ACTIVE) → soft close countdown (suggestion only).
 *
 * Returns null when there is nothing to say (an ACTIVE non-ephemeral space).
 */
export function SpaceStatusBanner({
    spaceId,
    type,
    status,
    expiresAt,
    canManage = false,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    expiresAt?: Date | string | null;
    /** OWNER/ADMIN see the close CTA. */
    canManage?: boolean;
}) {
    if (status === SpaceStatus.ARCHIVED) {
        return (
            <div className="flex items-center gap-3 rounded-2xl bg-secondary border border-[color:var(--line)] px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">Espacio archivado</p>
                    <p className="text-[12px] text-muted-foreground">Solo lectura — un recuerdo de lo compartido.</p>
                </div>
            </div>
        );
    }

    if (status === SpaceStatus.SETTLING) {
        return (
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--accent-tint)] border border-[color:var(--accent-border)] px-4 py-3">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">Cerrando cuentas</p>
                    <p className="text-[12px] text-muted-foreground">No se pueden crear gastos nuevos; solo liquidar.</p>
                </div>
                {canManage && (
                    <Link
                        href={`/spaces/${spaceId}/close`}
                        className="shrink-0 text-[12px] font-semibold text-primary hover:underline"
                    >
                        Ver cierre →
                    </Link>
                )}
            </div>
        );
    }

    // ACTIVE ephemeral with a suggested close date.
    if (type === SpaceType.EPHEMERAL && expiresAt) {
        const days = daysUntil(expiresAt);
        if (days === null) return null;
        const label =
            days < 0 ? "La fecha sugerida de cierre ya pasó" :
            days === 0 ? "El viaje termina hoy" :
            days === 1 ? "Queda 1 día sugerido" :
            `Quedan ${days} días sugeridos`;
        return (
            <div className="flex items-center gap-3 rounded-2xl bg-secondary border border-[color:var(--line)] px-4 py-3">
                <Hourglass className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{label}</p>
                    <p className="text-[12px] text-muted-foreground">Es solo una sugerencia; cierra cuando queráis.</p>
                </div>
                {canManage && (
                    <Link
                        href={`/spaces/${spaceId}/close`}
                        className="shrink-0 text-[12px] font-semibold text-primary hover:underline"
                    >
                        Cerrar →
                    </Link>
                )}
            </div>
        );
    }

    return null;
}
