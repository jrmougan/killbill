import { SpaceType, SpaceStatus } from "@/generated/prisma/enums";

/**
 * Presentation metadata for the four space modes (Fase 1 UI). Pure + DB-free so
 * it is shared by the switcher, the spaces hub and the management views. Copys
 * are neutral (avoid "tu pareja" outside COUPLE).
 */

export type SpaceTypeMeta = { emoji: string; label: string; blurb: string };

export const SPACE_TYPE_META: Record<SpaceType, SpaceTypeMeta> = {
    [SpaceType.INDIVIDUAL]: { emoji: "👤", label: "Personal", blurb: "Solo para ti" },
    [SpaceType.COUPLE]: { emoji: "💑", label: "Pareja", blurb: "Para dos personas" },
    [SpaceType.GROUP]: { emoji: "👪", label: "Grupo", blurb: "Familia, piso o amigos" },
    [SpaceType.EPHEMERAL]: { emoji: "✈️", label: "Viaje", blurb: "Temporal, con invitados" },
};

export function spaceTypeMeta(type: SpaceType | string): SpaceTypeMeta {
    return SPACE_TYPE_META[type as SpaceType] ?? SPACE_TYPE_META[SpaceType.GROUP];
}

export type SpaceStatusMeta = { label: string; tone: "active" | "settling" | "archived" };

export const SPACE_STATUS_META: Record<SpaceStatus, SpaceStatusMeta> = {
    [SpaceStatus.ACTIVE]: { label: "Activo", tone: "active" },
    [SpaceStatus.SETTLING]: { label: "Liquidando", tone: "settling" },
    [SpaceStatus.ARCHIVED]: { label: "Archivado", tone: "archived" },
};

export function spaceStatusMeta(status: SpaceStatus | string): SpaceStatusMeta {
    return SPACE_STATUS_META[status as SpaceStatus] ?? SPACE_STATUS_META[SpaceStatus.ACTIVE];
}

/** Days until expiry (EPHEMERAL close SUGGESTION). Negative = already past. */
export function daysUntil(expiresAt: Date | string | null | undefined): number | null {
    if (!expiresAt) return null;
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return null;
    const ms = d.getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
