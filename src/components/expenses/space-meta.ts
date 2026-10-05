/**
 * Display helpers for spaces in the Gastos / Añadir gasto screens. A space has
 * no stored emoji, so it is derived from its SpaceType (prototype mapping:
 * Pareja 💑, Piso/grupo 🏢, Viaje ✈️, Personal 👤).
 */

export const PERSONAL_SPACE = "personal" as const;

export function spaceEmoji(type: string | null | undefined): string {
    switch (type) {
        case "COUPLE": return "💑";
        case "GROUP": return "🏢";
        case "EPHEMERAL": return "✈️";
        default: return "👤";
    }
}

export function spaceTitle(space: { name?: string | null; type?: string | null } | null): string {
    if (!space) return `${spaceEmoji(null)} Personal`;
    return `${spaceEmoji(space.type)} ${space.name || "Espacio"}`;
}
