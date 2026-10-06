import { joinByCodeAllowed } from "./space-policy";
import { InviteKind, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Pure invite-redemption policy (DB-free, unit-tested).
 *
 * There are no short codes any more (product decision "no short codes"): a space
 * is only ever joined through a 256-bit `GroupInvite` link (or, for a guest, its
 * personal recovery link). The legacy 6-hex `Couple.code` is NOT an invitation.
 */

/**
 * Whether a REGISTERED account may join the space behind an invite of `kind`.
 *
 * - MEMBER link: ACTIVE COUPLE/GROUP (same gate as before).
 * - GUEST link: the ACTIVE EPHEMERAL trip it belongs to. A registered user who
 *   receives a trip's guest link joins it with their own account (role MEMBER)
 *   instead of being forced into a throwaway guest identity.
 */
export function accountJoinAllowed(kind: InviteKind, type: SpaceType, status: SpaceStatus): boolean {
    if (kind === InviteKind.GUEST) return type === SpaceType.EPHEMERAL && status === SpaceStatus.ACTIVE;
    return joinByCodeAllowed(type, status);
}

/** The session shape the claim/consent decisions care about. */
export type SessionKind = "none" | "registered" | "guest";

/** Classify a raw JWT payload (or null) into none/registered/guest. */
export function sessionKindOf(session: Record<string, unknown> | null | undefined): SessionKind {
    if (!session || typeof session.userId !== "string" || !session.userId) return "none";
    if (session.kind === "guest") return "guest";
    if (session.kind === undefined) return "registered";
    // Any other token kind (e.g. `mcp`) is not a browser session.
    return "none";
}

/**
 * Whether a request may OPEN A GUEST SESSION (guest entry or recovery link),
 * which overwrites the `session_token` cookie. A registered session is never
 * replaced silently (IE-02): the client must send an explicit
 * `replaceSession: true` after the user confirmed "cerrarás tu sesión".
 */
export function mayOpenGuestSession(current: SessionKind, replaceSession: boolean): boolean {
    return current !== "registered" || replaceSession === true;
}

/** Spanish message for the 409 returned when a registered session would be replaced. */
export const SESSION_EXISTS_MESSAGE =
    "Ya has iniciado sesión con tu cuenta. Únete con tu cuenta o confirma que quieres entrar como invitado (se cerrará tu sesión).";
