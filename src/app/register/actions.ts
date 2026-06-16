'use server';

import { prisma } from '@/lib/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import type { AuthState } from '@/lib/auth-types';

const SESSION_COOKIE = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
};

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const inviteCode = String(formData.get('inviteCode') ?? '').trim().toUpperCase();

    // Rate limit by client IP: 20 attempts / 5 minutes (looser than login).
    const ip = getClientIp(await headers());
    if (!rateLimit(`register:${ip}`, 20, 5 * 60 * 1000).allowed) {
        return { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' };
    }

    if (!name || !email || !password) {
        return { error: 'Nombre, email y contraseña obligatorios' };
    }
    if (password.length < 8) {
        return { error: 'La contraseña debe tener al menos 8 caracteres' };
    }
    if (!inviteCode) {
        return { error: 'Se requiere código de invitación' };
    }

    try {
        // Try to find as InviteCode first (admin-created); else as Couple code.
        const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });

        let couple = null;
        if (!invite) {
            couple = await prisma.couple.findUnique({
                where: { code: inviteCode },
                include: { members: true },
            });

            if (!couple) {
                return { error: 'Código de invitación inválido' };
            }
            if (couple.members.length >= 2) {
                return { error: 'Esta pareja ya está completa' };
            }
        } else {
            if (invite.usedById) {
                return { error: 'Este código ya fue utilizado' };
            }
            if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
                return { error: 'Este código ha expirado' };
            }
        }

        const existingUser = await prisma.user.findFirst({ where: { email } });
        if (existingUser) {
            return { error: 'Ya existe un usuario con este email' };
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user + consume invite atomically. The invite consume is
        // conditional (updateMany where still unused) so concurrent signups
        // can't both consume the same single-use code or overfill a couple.
        const inviteId = invite?.id;
        const coupleId = couple?.id;
        const user = await prisma.$transaction(async (tx) => {
            if (coupleId) {
                const memberCount = await tx.user.count({ where: { coupleId } });
                if (memberCount >= 2) throw new Error('COUPLE_FULL');
            }

            const created = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    avatar: '👤',
                    coupleId: couple?.id || undefined,
                },
            });

            if (inviteId) {
                const consumed = await tx.inviteCode.updateMany({
                    where: { id: inviteId, usedById: null },
                    data: { usedById: created.id, usedAt: new Date() },
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
    } catch (error) {
        if (error instanceof Error && error.message === 'INVITE_ALREADY_USED') {
            return { error: 'Este código ya fue utilizado' };
        }
        if (error instanceof Error && error.message === 'COUPLE_FULL') {
            return { error: 'Esta pareja ya está completa' };
        }
        console.error('Registration Error:', error);
        return { error: 'Algo salió mal. Inténtalo de nuevo.' };
    }

    // Outside try/catch so NEXT_REDIRECT propagates (see login action note).
    redirect('/dashboard');
}
