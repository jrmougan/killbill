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
    | "INVALID_UPGRADE"
    | "OPEN_BALANCES"
    | "PENDING_SETTLEMENTS"
    | "INVALID_NAME"
    | "INVALID_END_DATE";

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
 * Whether a space type supports custom categories (Fase 5). Every type does:
 * COUPLE/GROUP/EPHEMERAL manage space-scoped categories (by `groupId`) and
 * INDIVIDUAL manages personal ones (by `ownerId`). Categories only classify —
 * they carry no budget — so EPHEMERAL is included even though it vetoes budgets.
 * Kept as an explicit predicate (mirrors `allowsBudgetsAndRecurring`) so a future
 * product decision can restrict a type in one place.
 */
export function allowsCustomCategories(_type: SpaceType): boolean {
    return true;
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

/**
 * Throw if the space is ARCHIVED. Archived spaces are read-only: no rename, no
 * type upgrade (lifecycle transitions are gated by ALLOWED_TRANSITIONS).
 */
export function assertNotArchived(status: SpaceStatus): void {
    if (status === SpaceStatus.ARCHIVED) {
        throw new SpacePolicyError("SPACE_NOT_WRITABLE", "Este espacio está archivado (solo lectura)", 409);
    }
}

// --- Balances & closing ------------------------------------------------------

/**
 * A balance within ±1 cent is integer-split noise: /settle treats it as "en paz"
 * (`isAtPeace`, `resolveMyDebts`) so nothing could ever settle it. Every rule
 * that blocks on an open balance uses the same tolerance.
 */
export const SETTLE_TOLERANCE_CENTS = 1;

/** Whether a member's net balance (cents) still needs settling. */
export function hasOpenBalance(cents: number): boolean {
    return Math.abs(cents) > SETTLE_TOLERANCE_CENTS;
}

/** Where to settle a given space (the settle screen accepts `?space=`). */
export function settleUrlFor(spaceId: string): string {
    return `/settle?space=${encodeURIComponent(spaceId)}`;
}

/**
 * Archiving freezes a space (read-only, terminal), so it is only allowed once the
 * accounts are closed: every ACTIVE member's balance is (within the tolerance)
 * zero and no settlement is still PENDING — otherwise the debt would be locked
 * forever (IE-05/S-07). Throws 409; the route adds the settle link.
 */
export function assertCanArchive(args: {
    balances: Record<string, number>;
    pendingSettlements: number;
}): void {
    if (args.pendingSettlements > 0) {
        throw new SpacePolicyError(
            "PENDING_SETTLEMENTS",
            args.pendingSettlements === 1
                ? "Hay un pago pendiente de confirmar. Confírmalo o recházalo antes de archivar el espacio."
                : `Hay ${args.pendingSettlements} pagos pendientes de confirmar. Confírmalos o recházalos antes de archivar el espacio.`,
            409,
        );
    }
    if (Object.values(args.balances).some(hasOpenBalance)) {
        throw new SpacePolicyError(
            "OPEN_BALANCES",
            "Aún hay deudas sin saldar en este espacio. Quedad en paz antes de archivarlo.",
            409,
        );
    }
}

// --- Leaving a space ------------------------------------------------------------

export type LeaveBlock =
    | { code: "LAST_OWNER"; status: 409; error: string }
    | { code: "HAS_BALANCE"; status: 409; error: string; balanceCents: number };

/**
 * Rules for a SELF-leave (DELETE /api/spaces/[id]/members/[me]):
 *  - LAST_OWNER: the caller is the only ACTIVE OWNER and other members remain —
 *    the space would be left without anyone able to manage it. Not overridable
 *    by `force`: someone else must become OWNER first (or be the last one out).
 *  - HAS_BALANCE: the caller's net balance is open (beyond the ±1 cent
 *    tolerance). Leaving drops them from the ACTIVE ledger view, so this needs an
 *    explicit `?force=1` once the UI confirmed it with the user.
 * Returns null when leaving is allowed.
 */
export function leaveBlocker(args: {
    role: string;
    ownerCount: number;
    activeCount: number;
    balanceCents: number;
    force: boolean;
}): LeaveBlock | null {
    if (args.role === "OWNER" && args.ownerCount <= 1 && args.activeCount > 1) {
        return {
            code: "LAST_OWNER",
            status: 409,
            error: "Eres la única persona propietaria. Haz propietaria a otra persona antes de salir.",
        };
    }
    if (!args.force && hasOpenBalance(args.balanceCents)) {
        return {
            code: "HAS_BALANCE",
            status: 409,
            error: "Aún tienes saldo pendiente en este espacio.",
            balanceCents: Math.round(args.balanceCents),
        };
    }
    return null;
}

// --- Space name ---------------------------------------------------------------

export const SPACE_NAME_MAX = 60;

/** Trimmed, whitespace-collapsed space name (1–60 chars). Throws INVALID_NAME. */
export function normalizeSpaceName(raw: unknown): string {
    if (typeof raw !== "string") {
        throw new SpacePolicyError("INVALID_NAME", "El nombre debe ser un texto");
    }
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length === 0) {
        throw new SpacePolicyError("INVALID_NAME", "El nombre no puede estar vacío");
    }
    if (name.length > SPACE_NAME_MAX) {
        throw new SpacePolicyError("INVALID_NAME", `El nombre no puede superar los ${SPACE_NAME_MAX} caracteres`);
    }
    return name;
}

// --- Trip end date (EPHEMERAL) ---------------------------------------------------

const APP_TZ = "Europe/Madrid";
/** Furthest a trip may end (2 years) — guards against typos like 9999. */
const MAX_TRIP_MS = 2 * 366 * 24 * 60 * 60 * 1000;

function tzOffsetMs(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** 00:00 of local Y-M-D in `timeZone`, as a UTC instant (DST-safe). */
function zonedMidnight(y: number, monthIndex: number, d: number, timeZone: string): Date {
    const guess = new Date(Date.UTC(y, monthIndex, d));
    const off = tzOffsetMs(guess, timeZone);
    const candidate = new Date(guess.getTime() - off);
    const off2 = tzOffsetMs(candidate, timeZone);
    return off2 === off ? candidate : new Date(guess.getTime() - off2);
}

/** Today's calendar date in Madrid as "YYYY-MM-DD" (for `<input type=date min>`). */
export function madridToday(now: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Parse the trip's last day. The UI sends a calendar date ("YYYY-MM-DD"); it is
 * stored as the LAST instant of that day in Europe/Madrid (23:59:59.999), never
 * UTC midnight — guest sessions are hard-capped at `expiresAt`, so UTC midnight
 * locked guests out at 02:00 of the trip's last day (IE-06). A full ISO instant
 * is accepted as-is. Past (or > 2 years away) dates are rejected.
 */
export function parseTripEndDate(raw: unknown, now: Date = new Date()): Date {
    if (typeof raw !== "string" || raw.trim() === "") {
        throw new SpacePolicyError("INVALID_END_DATE", "La fecha de fin no es válida");
    }
    const value = raw.trim();
    let end: Date;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        const check = new Date(Date.UTC(y, mo, d));
        if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) {
            throw new SpacePolicyError("INVALID_END_DATE", "La fecha de fin no es válida");
        }
        end = new Date(zonedMidnight(y, mo, d + 1, APP_TZ).getTime() - 1);
    } else {
        end = new Date(value);
        if (Number.isNaN(end.getTime())) {
            throw new SpacePolicyError("INVALID_END_DATE", "La fecha de fin no es válida");
        }
    }
    if (end.getTime() <= now.getTime()) {
        throw new SpacePolicyError("INVALID_END_DATE", "La fecha de fin no puede estar en el pasado");
    }
    if (end.getTime() - now.getTime() > MAX_TRIP_MS) {
        throw new SpacePolicyError("INVALID_END_DATE", "La fecha de fin está demasiado lejos (máx. 2 años)");
    }
    return end;
}
