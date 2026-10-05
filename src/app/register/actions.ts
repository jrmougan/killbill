'use server';

import { prisma } from '@/lib/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { SPACE_CAPS, SpacePolicyError } from '@/lib/space-policy';
import { evaluateInvite, hashInviteToken, inviteInvalidMessage } from '@/lib/invite-token';
import { accountJoinAllowed } from '@/lib/invite-policy';
import { ephemeralSpacesEnabled } from '@/lib/flags';
import { ACTIVE_GROUP_COOKIE } from '@/lib/membership';
import { InviteKind, MembershipRole, MembershipStatus, SpaceStatus, SpaceType } from '@/generated/prisma/enums';
import type { AuthState } from '@/lib/auth-types';

const SESSION_COOKIE = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
};

/**
 * The resolved registration target after inspecting the supplied code/token.
 * Exactly one of the invite kinds authorizes creating the account:
 *  - adminInviteId: an admin-created InviteCode (instance stays CLOSED — this is
 *    the only self-service-less registration path).
 *  - groupInviteId + couple: a GroupInvite link — doubles as registration
 *    authorization AND a space join. A MEMBER link joins a COUPLE/GROUP; a GUEST
 *    link (trip) lets the visitor register and join the EPHEMERAL trip with an
 *    account instead of as a guest (IE-07).
 * The legacy 6-hex `Couple.code` is NOT accepted (no short codes, IE-04).
 */
type JoinTarget = {
    adminInviteId?: string;
    groupInviteId?: string;
    groupInviteMaxUses?: number;
    couple?: { id: string; type: SpaceType; status: SpaceStatus };
};

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    // Raw token from an invite link (case-sensitive GroupInvite token). Falls back
    // to the manually-typed admin invitation code field.
    const inviteToken = String(formData.get('inviteToken') ?? '').trim();
    const manualCode = String(formData.get('inviteCode') ?? '').trim();
    const effective = inviteToken || manualCode;

    // Rate limit by client IP: 20 attempts / 5 minutes (looser than login).
    const ip = getClientIp(await headers());
    if (!rateLimit(`register:${ip}`, 20, 5 * 60 * 1000).allowed) {
        return { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' };
    }

    if (!name || !email || !password) {
        return { error: 'Nombre, email y contraseña obligatorios' };
    }
    if (name.length > 60) {
        return { error: 'El nombre no puede superar los 60 caracteres' };
    }
    if (email.length > 191) {
        return { error: 'El email es demasiado largo' };
    }
    if (password.length < 8) {
        return { error: 'La contraseña debe tener al menos 8 caracteres' };
    }
    if (!effective) {
        return { error: 'Se requiere código de invitación' };
    }

    let joinedSpace = false;
    try {
        // Resolve the registration target: GroupInvite → admin InviteCode.
        // Read-only lookups; consumption happens in the tx.
        const target: JoinTarget = {};

        const groupInvite = await prisma.groupInvite.findUnique({
            where: { tokenHash: hashInviteToken(effective) },
            include: { group: { select: { id: true, type: true, status: true } } },
        });

        if (groupInvite) {
            if (groupInvite.kind === InviteKind.GUEST && !ephemeralSpacesEnabled()) {
                return { error: 'Este tipo de invitación no está disponible todavía' };
            }
            const validity = evaluateInvite(groupInvite);
            if (!validity.ok) {
                return { error: inviteInvalidMessage(validity.reason) };
            }
            const type = groupInvite.group.type as SpaceType;
            const status = groupInvite.group.status as SpaceStatus;
            if (!accountJoinAllowed(groupInvite.kind, type, status)) {
                return { error: 'Este espacio no admite unirse mediante este enlace' };
            }
            target.groupInviteId = groupInvite.id;
            target.groupInviteMaxUses = groupInvite.maxUses;
            target.couple = { id: groupInvite.group.id, type, status };
        } else {
            const code = effective.toUpperCase();
            const adminInvite = await prisma.inviteCode.findUnique({ where: { code } });
            if (adminInvite) {
                if (adminInvite.usedById) {
                    return { error: 'Este código ya fue utilizado' };
                }
                if (adminInvite.expiresAt && new Date(adminInvite.expiresAt) < new Date()) {
                    return { error: 'Este código ha expirado' };
                }
                target.adminInviteId = adminInvite.id;
            } else {
                return { error: 'Código de invitación inválido' };
            }
        }

        const existingUser = await prisma.user.findFirst({ where: { email } });
        if (existingUser) {
            return { error: 'Ya existe un usuario con este email' };
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user + join + consume the invite atomically. All consumes are
        // conditional (updateMany / cap re-check) so concurrent signups can't both
        // consume a single-use code, over-consume a link, or overfill a space.
        const coupleTarget = target.couple;
        const user = await prisma.$transaction(async (tx) => {
            let existingMemberCount = 0;
            if (coupleTarget) {
                existingMemberCount = await tx.membership.count({
                    where: { groupId: coupleTarget.id, status: MembershipStatus.ACTIVE },
                });
                if (existingMemberCount >= SPACE_CAPS[coupleTarget.type]) throw new SpacePolicyError('SPACE_FULL', 'full');
            }

            const created = await tx.user.create({
                data: { name, email, password: hashedPassword, avatar: '👤' },
            });

            if (coupleTarget) {
                await tx.membership.create({
                    data: {
                        groupId: coupleTarget.id,
                        userId: created.id,
                        role: existingMemberCount === 0 ? MembershipRole.OWNER : MembershipRole.MEMBER,
                        status: MembershipStatus.ACTIVE,
                    },
                });
            }

            if (target.adminInviteId) {
                const consumed = await tx.inviteCode.updateMany({
                    where: { id: target.adminInviteId, usedById: null },
                    data: { usedById: created.id, usedAt: new Date() },
                });
                if (consumed.count === 0) throw new Error('INVITE_ALREADY_USED');
            }

            if (target.groupInviteId) {
                const consumed = await tx.groupInvite.updateMany({
                    where: {
                        id: target.groupInviteId,
                        revokedAt: null,
                        expiresAt: { gt: new Date() },
                        usedCount: { lt: target.groupInviteMaxUses! },
                    },
                    data: { usedCount: { increment: 1 } },
                });
                if (consumed.count === 0) throw new Error('INVITE_ALREADY_USED');
            }

            return created;
        });

        // Set session (JWT) — cookie + redirect in one server response.
        const token = await signToken({
            userId: user.id,
            email: user.email,
            isAdmin: user.isAdmin,
        });

        const cookieStore = await cookies();
        cookieStore.set('session_token', token, SESSION_COOKIE);
        cookieStore.delete('user_id');
        joinedSpace = Boolean(coupleTarget);
        if (coupleTarget) {
            cookieStore.set(ACTIVE_GROUP_COOKIE, coupleTarget.id, {
                httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
            });
        }
    } catch (error) {
        if (error instanceof Error && error.message === 'INVITE_ALREADY_USED') {
            return { error: 'Este código ya fue utilizado' };
        }
        if (error instanceof SpacePolicyError) {
            return { error: 'Este espacio ya está completo' };
        }
        console.error('Registration Error:', error);
        return { error: 'Algo salió mal. Inténtalo de nuevo.' };
    }

    // Outside try/catch so NEXT_REDIRECT propagates (see login action note).
    // A brand-new account that did not join a space through an invite lands on
    // the optional onboarding (`/welcome`: who do you share expenses with?).
    redirect(joinedSpace ? '/dashboard' : '/welcome');
}
