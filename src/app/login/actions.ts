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

    // Per-account limit as well (10 attempts / 15 minutes per email): a password
    // guess spread across many IPs still hits the same bucket.
    if (!rateLimit(`login-account:${email.toLowerCase()}`, 10, 15 * 60 * 1000).allowed) {
        return { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' };
    }

    let firstRun = false;
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) {
            return { error: 'Credenciales incorrectas' };
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return { error: 'Credenciales incorrectas' };
        }

        // SECURITY (Fase 2): login NEVER auto-joins a group. The old `?code=`
        // silent auto-join let a shared link drop the victim into someone else's
        // group without consent. Now the invite token is carried through and,
        // after authentication, the user is redirected to the explicit consent
        // screen `/i/[token]` where they choose to join. (Legacy 6-hex
        // `Couple.code` values no longer resolve there: no short codes.)

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

        // Onboarding (IE-09): an account with no space ever (no membership row in
        // any status) and no expense of its own has never used the app — offer
        // the optional `/welcome` instead of an empty Inicio.
        if (!inviteCode) {
            const [memberships, expenses] = await Promise.all([
                prisma.membership.count({ where: { userId: user.id } }),
                prisma.expense.count({ where: { OR: [{ paidById: user.id }, { ownerId: user.id }] } }),
            ]);
            firstRun = memberships === 0 && expenses === 0;
        }
    } catch (error) {
        console.error('Login Error:', error);
        return { error: 'Algo salió mal. Inténtalo de nuevo.' };
    }

    // redirect() throws NEXT_REDIRECT and must live OUTSIDE the try/catch so it
    // isn't swallowed. Server-driven navigation = no client cookie/cache race.
    // With an invite code present, land on the consent screen instead of the
    // dashboard so the join is explicit.
    if (inviteCode) {
        redirect(`/i/${encodeURIComponent(inviteCode)}`);
    }
    redirect(firstRun ? '/welcome' : '/dashboard');
}
