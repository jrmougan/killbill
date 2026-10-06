/**
 * Zod schemas of the space-management write bodies (/api/spaces/**). Shape only:
 * the policy rules that carry a machine `code` (normalizeSpaceName → INVALID_NAME,
 * parseTripEndDate → INVALID_END_DATE, transitions, caps…) stay in space-policy
 * and are applied by the handlers, so those fields are passed through as unknown.
 * Messages are the routes' historical ones ("Cuerpo inválido", "Estado no válido"…).
 */
import { z } from "zod";
import type { ParseJsonOptions } from "@/lib/http";
import { id } from "@/lib/http/schemas";
import { InviteKind, MembershipRole, SpaceStatus, SpaceType } from "@/generated/prisma/enums";

/** Historical 400 of the space routes for an unparseable / non-object body. */
export const INVALID_SPACE_BODY = "Cuerpo inválido";

/** `parseJson` options of the space routes: an unparseable body keeps "Cuerpo inválido". */
export const SPACE_BODY_OPTIONS: ParseJsonOptions = { invalidMessage: INVALID_SPACE_BODY };

const passthrough = z.unknown().optional();

function spaceObject<T extends z.ZodRawShape>(shape: T) {
    return z.object(shape, { error: INVALID_SPACE_BODY });
}

/** Types a user may create directly (INDIVIDUAL is virtual and never materialized). */
export const CREATABLE_SPACE_TYPES = [SpaceType.COUPLE, SpaceType.GROUP, SpaceType.EPHEMERAL] as const;

/** POST /api/spaces. `name` → normalizeSpaceName, `expiresAt` → parseTripEndDate (EPHEMERAL only). */
export const CreateSpaceBody = spaceObject({
    type: z.enum(CREATABLE_SPACE_TYPES, { error: "type es obligatorio y debe ser COUPLE, GROUP o EPHEMERAL" }),
    name: passthrough,
    expiresAt: passthrough,
});
export type CreateSpaceBody = z.output<typeof CreateSpaceBody>;

/** PATCH /api/spaces/[id]: any combination of a transition, the COUPLE→GROUP upgrade and a rename. */
export const PatchSpaceBody = spaceObject({
    status: z.enum(SpaceStatus, { error: "Estado no válido" }).optional(),
    type: z.enum(SpaceType, { error: "Tipo no válido" }).optional(),
    name: passthrough,
});
export type PatchSpaceBody = z.output<typeof PatchSpaceBody>;

/**
 * POST /api/spaces/[id]/invites. `expiresAt` / `maxUses` depend on the kind and
 * on the space (defaults, ceilings) and are checked in the handler.
 */
export const CreateInviteBody = spaceObject({
    kind: z.enum([InviteKind.MEMBER, InviteKind.GUEST], { error: "Tipo de invitación no válido" }).optional(),
    expiresAt: passthrough,
    maxUses: passthrough,
});
export type CreateInviteBody = z.output<typeof CreateInviteBody>;

/** Roles an OWNER may assign (GUEST is never assignable). */
export const ASSIGNABLE_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER] as const;

/** PATCH /api/spaces/[id]/members/[userId]. */
export const MemberRoleBody = spaceObject({
    role: z.enum(ASSIGNABLE_ROLES, { error: "Rol no válido" }),
});
export type MemberRoleBody = z.output<typeof MemberRoleBody>;

/** `{ id, userId }` segments of /api/spaces/[id]/members/[userId]. */
export const memberParams = z.object({ id: id(), userId: id() });
