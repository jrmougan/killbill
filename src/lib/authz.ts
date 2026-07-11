import { prisma } from "./db";
import { getSession } from "./auth";
import { assertSpaceWritable, SpacePolicyError } from "./space-policy";
import type { Couple, Membership } from "@/generated/prisma/client";
import { MembershipRole, MembershipStatus, SpaceStatus } from "@/generated/prisma/enums";

/**
 * Central authorization for space-scoped resources (Fase 1).
 *
 * Design invariants (plan §2.4):
 * - Authorize ALWAYS against the group of the RESOURCE, never the `active_group`
 *   cookie (that cookie is a UI preference only).
 * - Verify role against the Membership row in the DB, never the JWT claim alone
 *   (so an expelled/downgraded member is denied per-request, no blacklist).
 * - For guests, additionally require that the requested groupId matches the
 *   groupId embedded in the guest JWT, so a guest is caged to its single space.
 * - Apply writability by status unless the caller opts into read (allowArchived).
 */

/**
 * Minimal session context. Today `getSession()` returns the raw JWT payload
 * ({userId, email, isAdmin}); guest sessions (Fase 3) will add {kind:'guest',
 * groupId, role}. This shape is forward-compatible with both.
 */
export type SessionCtx = {
    userId: string;
    isAdmin?: boolean;
    /** Present only on guest sessions (Fase 3). */
    kind?: "guest";
    /** The single space a guest is caged to (guest JWT claim). */
    groupId?: string;
    /** Role claim carried by a guest JWT (revalidated against DB regardless). */
    role?: MembershipRole;
};

export type RequireSpaceOptions = {
    /** Allowed roles. If omitted, any ACTIVE member (incl. GUEST) is accepted. */
    roles?: MembershipRole[];
    /** Permit GUEST sessions/role. Defaults to false (guests denied). */
    allowGuest?: boolean;
    /**
     * Permit access to a SETTLING/ARCHIVED space (read-only views, settle flows).
     * Defaults to false → assertSpaceWritable blocks non-ACTIVE spaces.
     */
    allowArchived?: boolean;
};

export type SpaceAccessOk = {
    ok: true;
    userId: string;
    space: Couple;
    membership: Membership;
    role: MembershipRole;
    isGuest: boolean;
};

export type SpaceAccessErr = {
    ok: false;
    status: number;
    error: string;
    /** Policy code when the denial came from space-policy (e.g. SPACE_NOT_WRITABLE). */
    code?: string;
};

export type SpaceAccessResult = SpaceAccessOk | SpaceAccessErr;

/** Read the current session as a SessionCtx, or null when unauthenticated. */
export async function getSessionCtx(): Promise<SessionCtx | null> {
    const session = await getSession();
    if (!session?.userId) return null;
    return {
        userId: session.userId as string,
        isAdmin: session.isAdmin === true,
        kind: session.kind === "guest" ? "guest" : undefined,
        groupId: typeof session.groupId === "string" ? session.groupId : undefined,
        role: typeof session.role === "string" ? (session.role as MembershipRole) : undefined,
    };
}

/**
 * Authorize the caller against the space that owns a resource.
 *
 * Returns a discriminated result instead of throwing so route handlers can
 * early-return a JSON response without try/catch boilerplate:
 *
 *   const auth = await requireSpaceAccess(ctx, groupId, { roles: ['OWNER','ADMIN'] });
 *   if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
 *   // ...use auth.space / auth.membership / auth.role
 */
export async function requireSpaceAccess(
    ctx: SessionCtx | null,
    groupId: string,
    options: RequireSpaceOptions = {},
): Promise<SpaceAccessResult> {
    if (!ctx?.userId) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }
    if (!groupId) {
        return { ok: false, status: 400, error: "Falta el identificador del espacio" };
    }

    const allowGuest = options.allowGuest === true;

    // A guest session is caged to the space in its JWT: it may only ever touch
    // that one groupId. Reject cross-space access before hitting the DB.
    if (ctx.kind === "guest") {
        if (!allowGuest) {
            return { ok: false, status: 403, error: "Acción no permitida para invitados" };
        }
        if (ctx.groupId && ctx.groupId !== groupId) {
            return { ok: false, status: 403, error: "Un invitado solo puede acceder a su espacio" };
        }
    }

    // Authorize against the RESOURCE's group. Load the space + the caller's
    // membership in it. Role is taken from the DB row, never the JWT claim.
    const [space, membership] = await Promise.all([
        prisma.couple.findUnique({ where: { id: groupId } }),
        prisma.membership.findUnique({
            where: { groupId_userId: { groupId, userId: ctx.userId } },
        }),
    ]);

    if (!space) {
        return { ok: false, status: 404, error: "Espacio no encontrado" };
    }
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
        return { ok: false, status: 403, error: "No perteneces a este espacio" };
    }

    const role = membership.role;
    const isGuest = role === MembershipRole.GUEST;

    // A GUEST membership is only acceptable when the caller explicitly allows it.
    if (isGuest && !allowGuest) {
        return { ok: false, status: 403, error: "Acción no permitida para invitados" };
    }

    // Role gate (checked against the DB row). GUEST passes only via allowGuest above.
    if (options.roles && !options.roles.includes(role)) {
        return { ok: false, status: 403, error: "No tienes permisos para esta acción" };
    }

    // Status gate. Read-only views/settle flows opt out via allowArchived; every
    // mutating handler leaves it false so SETTLING/ARCHIVED spaces reject writes.
    if (!options.allowArchived) {
        try {
            assertSpaceWritable(space.status as SpaceStatus);
        } catch (e) {
            if (e instanceof SpacePolicyError) {
                return { ok: false, status: e.status, error: e.message, code: e.code };
            }
            throw e;
        }
    }

    return { ok: true, userId: ctx.userId, space, membership, role, isGuest };
}
