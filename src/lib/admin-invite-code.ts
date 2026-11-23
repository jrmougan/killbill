/**
 * Shape of an admin registration code (`InviteCode.code`): 8 hex characters,
 * as `createInviteFor` generates them. A space invitation is a 43-character
 * base64url token (`generateInviteToken`), so the two can never be confused.
 * Client-safe on purpose (no `crypto`): the register page uses it to tell which
 * kind of link it was opened from.
 */
const ADMIN_INVITE_CODE = /^[0-9a-f]{8}$/i;

export function isAdminInviteCode(code: string | null | undefined): code is string {
    return typeof code === "string" && ADMIN_INVITE_CODE.test(code);
}
