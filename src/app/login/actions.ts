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

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const inviteCodeRaw = formData.get('inviteCode');
    const inviteCode = inviteCodeRaw ? String(inviteCodeRaw).trim() : null;

    // Rate limit by client IP: 10 attempts / 5 minutes.
    const ip = getClientIp(await headers());
    if (!rateLimit(`login:${ip}`, 10, 5 * 60 * 1000).allowed) {
        return { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' };
    }

    if (!email || !password) {
        return { error: 'Email y contraseña obligatorios' };
    }

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) {
            return { error: 'Credenciales incorrectas' };
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return { error: 'Credenciales incorrectas' };
        }

        // Handle couple invite (explicit + safe): only join when the user has no
        // couple yet, the code is valid, and the couple still has room. Done
        // atomically so two concurrent joins can't overfill the couple.
        if (inviteCode && !user.coupleId) {
            const couple = await prisma.couple.findUnique({
                where: { code: inviteCode },
                include: { members: true },
            });

            if (couple && couple.members.length < 2) {
                await prisma.$transaction(async (tx) => {
                    const memberCount = await tx.user.count({ where: { coupleId: couple.id } });
                    if (memberCount >= 2) return;
                    await tx.user.updateMany({
                        where: { id: user.id, coupleId: null },
                        data: { coupleId: couple.id },
                    });
                });
            }
        }

        // Set session (JWT). Cookie write + redirect happen in the same server
        // response, so the middleware sees the cookie on the /dashboard request.
        const token = await signToken({
            userId: user.id,
            email: user.email,
            isAdmin: user.isAdmin,
        });

        const cookieStore = await cookies();
        cookieStore.set('session_token', token, SESSION_COOKIE);
        cookieStore.delete('user_id'); // clear old insecure cookie if present
    } catch (error) {
        console.error('Login Error:', error);
        return { error: 'Algo salió mal. Inténtalo de nuevo.' };
    }

    // redirect() throws NEXT_REDIRECT and must live OUTSIDE the try/catch so it
    // isn't swallowed. Server-driven navigation = no client cookie/cache race.
    redirect('/dashboard');
}
