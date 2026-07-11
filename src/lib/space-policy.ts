import { MAX_GROUP_MEMBERS } from "./membership";
import { SpaceType, SpaceStatus } from "@/generated/prisma/enums";

/**
 * Central policy for the four space modes (Fase 1). Single source of truth for
 * membership caps, guest access, join-by-code, writability, lifecycle
 * transitions and the one allowed type upgrade. Everything here is pure and
 * DB-free so it is trivially unit-testable and callable from both server routes
 * and the authz helper.
 *
 * Product decisions already fixed (owner will review later):
 * - COUPLE cap = 2 STRICT; only upgrade path is COUPLE -> GROUP.
 * - Guests only in EPHEMERAL.
 * - join-by-code disabled for EPHEMERAL (invite links only) and requires ACTIVE.
 */

/**
 * Max ACTIVE members per space type. GROUP/EPHEMERAL reuse the existing
 * MAX_GROUP_MEMBERS (20) so the cap stays in one place; COUPLE is a hard 2;
 * INDIVIDUAL is virtual (no rows) but kept here for completeness.
 */
export const SPACE_CAPS: Record<SpaceType, number> = {
    [SpaceType.INDIVIDUAL]: 1,
    [SpaceType.COUPLE]: 2,
    [SpaceType.GROUP]: MAX_GROUP_MEMBERS,
    [SpaceType.EPHEMERAL]: MAX_GROUP_MEMBERS,
};

/** Machine-readable policy error codes, surfaced to the client for UX. */
export type SpacePolicyCode =
    | "SPACE_FULL"
    | "SPACE_NOT_WRITABLE"
    | "JOIN_NOT_ALLOWED"
    | "INVALID_TRANSITION"
    | "INVALID_UPGRADE";

/** Typed policy violation. Handlers map `.code`/`.status` to a JSON response. */
export class SpacePolicyError extends Error {
    code: SpacePolicyCode;
    status: number;
    constructor(code: SpacePolicyCode, message: string, status = 400) {
        super(message);
        this.name = "SpacePolicyError";
        this.code = code;
        this.status = status;
    }
}

/** Member cap for a given type. */
export function capFor(type: SpaceType): number {
    return SPACE_CAPS[type];
}

/** Guests (User shadow + Membership GUEST) are only ever allowed in EPHEMERAL. */
export function allowsGuests(type: SpaceType): boolean {
    return type === SpaceType.EPHEMERAL;
}

/** Budgets and recurring expenses are vetoed in EPHEMERAL spaces (product #3). */
export function allowsBudgetsAndRecurring(type: SpaceType): boolean {
    return type !== SpaceType.EPHEMERAL;
}

/**
 * Whether a space may be joined via the classic `Couple.code`. Only COUPLE and
 * GROUP support it, and only while ACTIVE. EPHEMERAL uses expirable invite links
 * exclusively; INDIVIDUAL is virtual and un-joinable; SETTLING/ARCHIVED are
 * closed to new members.
 */
export function joinByCodeAllowed(type: SpaceType, status: SpaceStatus): boolean {
    if (status !== SpaceStatus.ACTIVE) return false;
    return type === SpaceType.COUPLE || type === SpaceType.GROUP;
}

/** A space accepts writes (new expenses/settlements) only while ACTIVE. */
export function isSpaceWritable(status: SpaceStatus): boolean {
    return status === SpaceStatus.ACTIVE;
}

/**
 * Throw if the space is not writable (SETTLING blocks new expenses but the
 * caller decides whether settling is allowed; ARCHIVED is fully read-only).
 * Use this on every mutating handler that creates/edits expenses.
 */
export function assertSpaceWritable(status: SpaceStatus): void {
    if (!isSpaceWritable(status)) {
        throw new SpacePolicyError(
            "SPACE_NOT_WRITABLE",
            status === SpaceStatus.ARCHIVED
                ? "Este espacio está archivado (solo lectura)"
                : "Este espacio se está liquidando: no se pueden crear gastos nuevos",
            409,
        );
    }
}

/**
 * Allowed lifecycle transitions:
 *   ACTIVE   -> SETTLING (start closing) | ARCHIVED (archive with history)
 *   SETTLING -> ACTIVE   (reopen)        | ARCHIVED (finish closing)
 *   ARCHIVED -> (terminal)
 */
const ALLOWED_TRANSITIONS: Record<SpaceStatus, SpaceStatus[]> = {
    [SpaceStatus.ACTIVE]: [SpaceStatus.SETTLING, SpaceStatus.ARCHIVED],
    [SpaceStatus.SETTLING]: [SpaceStatus.ACTIVE, SpaceStatus.ARCHIVED],
    [SpaceStatus.ARCHIVED]: [],
};

/** Pure predicate for a status transition. Identity (no-op) is not a transition. */
export function canTransitionStatus(from: SpaceStatus, to: SpaceStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throwing variant used by the PATCH handler. */
export function assertStatusTransition(from: SpaceStatus, to: SpaceStatus): void {
    if (from === to) {
        throw new SpacePolicyError(
            "INVALID_TRANSITION",
            `El espacio ya está en estado ${to}`,
        );
    }
    if (!canTransitionStatus(from, to)) {
        throw new SpacePolicyError(
            "INVALID_TRANSITION",
            `Transición no permitida: ${from} → ${to}`,
        );
    }
}

/**
 * The only allowed type upgrade is COUPLE -> GROUP (escape the cap-2 and a
 * mis-classified backfill). Everything else is rejected.
 */
export function canUpgradeType(from: SpaceType, to: SpaceType): boolean {
    return from === SpaceType.COUPLE && to === SpaceType.GROUP;
}

/** Throwing variant used by the "Convertir en grupo" action. */
export function assertTypeUpgrade(from: SpaceType, to: SpaceType): void {
    if (!canUpgradeType(from, to)) {
        throw new SpacePolicyError(
            "INVALID_UPGRADE",
            "Solo se permite convertir una pareja en grupo (COUPLE → GROUP)",
        );
    }
}

/**
 * Throw SPACE_FULL if adding one more ACTIVE member would exceed the cap for
 * this type. `activeCount` is the current ACTIVE membership count.
 */
export function assertHasRoom(type: SpaceType, activeCount: number): void {
    if (activeCount >= capFor(type)) {
        throw new SpacePolicyError(
            "SPACE_FULL",
            type === SpaceType.COUPLE
                ? "Esta pareja ya está completa (máx. 2). Puedes convertirla en grupo."
                : "Este espacio ya está completo",
        );
    }
}
