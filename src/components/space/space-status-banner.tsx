import Link from "next/link";
import { Lock, Clock, Hourglass } from "lucide-react";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

/**
 * Contextual banner for a space's lifecycle state. Rendered on Inicio and the
 * space management page:
 *  - SETTLING → "cerrando cuentas · faltan N deudas" with a single CTA: settle
 *    THIS space (`settleHref`) if the viewer has something open; else "Ver qué
 *    falta" (/close, registered members only) or, once everything is settled,
 *    "Archivar" for OWNER/ADMIN. Guests only see the progress text.
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
    openDebts = 0,
    myBalanceOpen = false,
    isGuest = false,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    expiresAt?: Date | string | null;
    /** OWNER/ADMIN see the close CTA. */
    canManage?: boolean;
    /** Where to settle this space (SETTLING). Omit to hide the link. */
    settleHref?: string;
    /** SETTLING: members who still owe (same rule as the archive guard). */
    openDebts?: number;
    /** SETTLING: the viewer still owes or is owed something here. */
    myBalanceOpen?: boolean;
    /** Guests never get a link to the close flow. */
    isGuest?: boolean;
}) {
    if (status === SpaceStatus.ARCHIVED) {
        return (
            <div data-testid="space-status-banner" data-status={status} className="flex items-center gap-3 rounded-2xl bg-[var(--track)] px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">Espacio archivado</p>
                    <p className="text-[12px] text-muted-foreground">Solo lectura: puedes consultar lo compartido, pero no añadir ni cambiar nada.</p>
                </div>
            </div>
        );
    }

    if (status === SpaceStatus.SETTLING) {
        const done = openDebts === 0;
        // One CTA: settle my part first; else what's missing (registered only), or archive when all is settled.
        const cta =
            settleHref && myBalanceOpen
                ? { href: settleHref, testId: "space-status-settle-link", label: "Saldar deudas →" }
                : done && canManage && !isGuest
                    ? { href: `/spaces/${spaceId}/close`, testId: "space-status-close-link", label: "Todo saldado · Archivar →" }
                    : !done && !isGuest
                        ? { href: `/spaces/${spaceId}/close`, testId: "space-status-close-link", label: "Ver qué falta →" }
                        : null;
        return (
            <div data-testid="space-status-banner" data-status={status} className="flex items-start gap-3 rounded-2xl bg-[var(--accent-tint)] border border-[color:var(--accent-border)] px-4 py-3">
                <Clock className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p data-testid="space-status-progress" className="text-[13px] font-semibold text-foreground">
                        Cerrando cuentas · {done ? "estáis al día" : openDebts === 1 ? "falta 1 deuda" : `faltan ${openDebts} deudas`}
                    </p>
                    <p className="text-[12px] text-muted-foreground">No se pueden añadir ni editar gastos; sí saldar deudas.</p>
                    {cta && (
                        <Link
                            href={cta.href}
                            data-testid={cta.testId}
                            className="-mb-2 min-h-11 inline-flex items-center text-[13px] font-semibold text-primary"
                        >
                            {cta.label}
                        </Link>
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
