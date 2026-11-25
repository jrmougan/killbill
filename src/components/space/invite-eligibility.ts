import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { capFor, joinByCodeAllowed, allowsGuests } from "@/lib/space-policy";

/** Most uses a single shared link gets in a GROUP (the API ceiling is higher). */
const GROUP_LINK_USES = 10;

export type InviteConfig = { kind: "MEMBER" | "GUEST"; maxUses: number };

/**
 * Whether the "Invitar a…" card is offered for a space, and with which link
 * shape. Mirrors the server rules of `POST /api/spaces/[id]/invites` (which
 * stays the authority): OWNER/ADMIN only, ACTIVE only, MEMBER links where
 * join-by-membership is allowed (COUPLE/GROUP) and only while there is room,
 * GUEST links for EPHEMERAL only when the ephemeral flag is on.
 */
export function inviteConfigFor(
    space: { type: SpaceType | string; status: SpaceStatus | string; role: string; memberCount: number },
    ephemeralEnabled: boolean,
): InviteConfig | null {
    if (space.role !== "OWNER" && space.role !== "ADMIN") return null;
    const type = space.type as SpaceType;
    const status = space.status as SpaceStatus;
    if (status !== SpaceStatus.ACTIVE) return null;
    const room = capFor(type) - space.memberCount;
    if (room <= 0) return null;
    if (allowsGuests(type)) {
        return ephemeralEnabled ? { kind: "GUEST", maxUses: Math.min(GROUP_LINK_USES, room) } : null;
    }
    if (!joinByCodeAllowed(type, status)) return null;
    return { kind: "MEMBER", maxUses: type === SpaceType.COUPLE ? 1 : Math.min(GROUP_LINK_USES, room) };
}
