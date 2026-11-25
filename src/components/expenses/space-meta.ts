import { SPACE_TYPE_META, spaceTypeMeta } from "@/lib/space-ui";

/**
 * Display helpers for spaces in the Gastos / Añadir gasto screens. A space has
 * no stored emoji, so it is derived from its SpaceType via `SPACE_TYPE_META`
 * (the single source shared with Inicio, Espacios and Mes).
 */

export const PERSONAL_SPACE = "personal" as const;

export function spaceEmoji(type: string | null | undefined): string {
    return type ? spaceTypeMeta(type).emoji : SPACE_TYPE_META.INDIVIDUAL.emoji;
}

export function spaceTitle(space: { name?: string | null; type?: string | null } | null): string {
    if (!space) return `${spaceEmoji(null)} Personal`;
    return `${spaceEmoji(space.type)} ${space.name || "Espacio"}`;
}
