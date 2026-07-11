import { randomBytes, createHash } from "crypto";

/**
 * Invite-link token helpers (Fase 2).
 *
 * A GroupInvite link is a bearer credential: `base64url(randomBytes(32))` (256
 * bits of entropy), shown to the creator EXACTLY ONCE. The database never stores
 * the plaintext token — only its sha256 (`tokenHash`, unique) plus a short
 * `tokenPrefix` so the UI can list/identify a link without being able to
 * reconstruct it. This mirrors the hash-only handling of a password.
 *
 * Everything here is pure and DB-free so validity/expiration/revocation logic is
 * trivially unit-testable and shared by the preview, claim and register paths.
 */

/** Length of the human-facing prefix stored to identify a link in the UI. */
export const INVITE_TOKEN_PREFIX_LEN = 8;

/** Generate a fresh 256-bit URL-safe invite token (plaintext, shown once). */
export function generateInviteToken(): string {
    return randomBytes(32).toString("base64url");
}

/** sha256 hex digest of a token — the only form persisted (`tokenHash`). */
export function hashInviteToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Short, non-secret prefix persisted alongside the hash to list links in the UI. */
export function tokenPrefix(token: string): string {
    return token.slice(0, INVITE_TOKEN_PREFIX_LEN);
}

/** Why an invite cannot be redeemed. */
export type InviteInvalidReason = "REVOKED" | "EXPIRED" | "EXHAUSTED";

export type InviteValidity =
    | { ok: true }
    | { ok: false; reason: InviteInvalidReason };

/** The subset of a GroupInvite row needed to judge redeemability. */
export type InviteState = {
    revokedAt: Date | null;
    expiresAt: Date;
    maxUses: number;
    usedCount: number;
};

/**
 * Pure redeemability check, ordered by severity: revoked → expired → exhausted.
 * `now` is injectable for deterministic tests. The DB claim additionally guards
 * against races with a conditional `updateMany`; this is the cheap pre-check.
 */
export function evaluateInvite(invite: InviteState, now: Date = new Date()): InviteValidity {
    if (invite.revokedAt) return { ok: false, reason: "REVOKED" };
    if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "EXPIRED" };
    if (invite.usedCount >= invite.maxUses) return { ok: false, reason: "EXHAUSTED" };
    return { ok: true };
}

/** Spanish, user-facing message for an invalid invite reason. */
export function inviteInvalidMessage(reason: InviteInvalidReason): string {
    switch (reason) {
        case "REVOKED":
            return "Este enlace de invitación ha sido revocado";
        case "EXPIRED":
            return "Este enlace de invitación ha caducado";
        case "EXHAUSTED":
            return "Este enlace de invitación ya no admite más usos";
    }
}
