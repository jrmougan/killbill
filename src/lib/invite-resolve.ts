import { prisma } from "./db";
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from "./invite-token";
import { accountJoinAllowed } from "./invite-policy";
import { allowsGuests, SPACE_CAPS } from "./space-policy";
import { ephemeralSpacesEnabled } from "./flags";
import { InviteKind, MembershipRole, MembershipStatus, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/**
 * Server-side resolution of an `/i/[token]` link for the consent screen.
 *
 * A token is one of:
 * - a MEMBER `GroupInvite` (join a COUPLE/GROUP with an account);
 * - a GUEST `GroupInvite` (enter an EPHEMERAL trip by name, or join it with an
 *   account);
 * - a guest's personal RECOVERY token (`Membership.guestTokenHash`) to re-open
 *   the guest session on another device (IE-03).
 *
 * The legacy 6-hex `Couple.code` is deliberately NOT resolved (IE-04/T-09): it is
 * guessable, so it must neither join nor reveal the space name.
 */
export type ResolvedInvite =
    /**
     * `spaceId`/`spaceName` are only set when the token IS a real invite of that
     * space (e.g. an exhausted link), so the page can tell an existing member
     * "ya eres miembro". Never show them to anyone else.
     */
    | { ok: false; message: string; spaceId?: string; spaceName?: string }
    | {
        ok: true;
        kind: "MEMBER" | "GUEST";
        spaceId: string;
        spaceName: string;
        spaceType: SpaceType;
        /** Whether a registered account may join with this link (accountJoinAllowed). */
        accountJoinable: boolean;
    }
    | { ok: true; kind: "RECOVERY"; spaceId: string; spaceName: string; guestName: string };

export const INVITE_NOT_FOUND_MESSAGE = "Enlace de invitación no encontrado o caducado.";

export async function resolveInviteToken(token: string): Promise<ResolvedInvite> {
    if (!token) return { ok: false, message: INVITE_NOT_FOUND_MESSAGE };
    const tokenHash = hashInviteToken(token);

    const invite = await prisma.groupInvite.findUnique({
        where: { tokenHash },
        include: { group: { select: { id: true, name: true, type: true, status: true } } },
    });

    if (invite) {
        const type = invite.group.type as SpaceType;
        const status = invite.group.status as SpaceStatus;
        const spaceName = invite.group.name ?? "el espacio";
        const known = { spaceId: invite.group.id, spaceName };
        const validity = evaluateInvite(invite);
        const isFull = async () =>
            (await prisma.membership.count({ where: { groupId: invite.group.id, status: MembershipStatus.ACTIVE } })) >=
            SPACE_CAPS[type];
        if (invite.kind === InviteKind.GUEST) {
            if (!ephemeralSpacesEnabled()) {
                return { ok: false, message: "Este tipo de invitación no está disponible todavía." };
            }
            if (!validity.ok) return { ok: false, message: inviteInvalidMessage(validity.reason), ...known };
            if (!allowsGuests(type) || status !== SpaceStatus.ACTIVE) {
                return { ok: false, message: "Este espacio ya no admite invitados.", ...known };
            }
            if (await isFull()) return { ok: false, message: "Este espacio ya está completo.", ...known };
            return {
                ok: true,
                kind: "GUEST",
                spaceId: invite.group.id,
                spaceName,
                spaceType: type,
                accountJoinable: accountJoinAllowed(InviteKind.GUEST, type, status),
            };
        }
        if (!validity.ok) return { ok: false, message: inviteInvalidMessage(validity.reason), ...known };
        if (!accountJoinAllowed(InviteKind.MEMBER, type, status)) {
            return { ok: false, message: "Este espacio ya no admite nuevos miembros.", ...known };
        }
        if (await isFull()) return { ok: false, message: "Este espacio ya está completo.", ...known };
        return { ok: true, kind: "MEMBER", spaceId: invite.group.id, spaceName, spaceType: type, accountJoinable: true };
    }

    if (ephemeralSpacesEnabled()) {
        const membership = await prisma.membership.findUnique({
            where: { guestTokenHash: tokenHash },
            select: {
                role: true,
                status: true,
                user: { select: { name: true, isGuest: true } },
                group: { select: { id: true, name: true, status: true } },
            },
        });
        if (membership) {
            if (
                membership.role !== MembershipRole.GUEST ||
                !membership.user.isGuest ||
                membership.status !== MembershipStatus.ACTIVE ||
                membership.group.status === SpaceStatus.ARCHIVED
            ) {
                return { ok: false, message: "Este enlace personal ya no es válido." };
            }
            return {
                ok: true,
                kind: "RECOVERY",
                spaceId: membership.group.id,
                spaceName: membership.group.name ?? "el espacio",
                guestName: membership.user.name,
            };
        }
    }

    return { ok: false, message: INVITE_NOT_FOUND_MESSAGE };
}
