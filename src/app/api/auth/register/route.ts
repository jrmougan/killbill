import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { signToken } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
    try {
        // Rate limit by client IP: 20 attempts / 5 minutes (looser than login).
        const ip = getClientIp(request);
        const limit = rateLimit(`register:${ip}`, 20, 5 * 60 * 1000);
        if (!limit.allowed) {
            return NextResponse.json(
                { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' },
                { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
            );
        }

        const body = await request.json();
        const { name, email, password, inviteCode } = body;

        if (!name || !email || !password) {
            return NextResponse.json({ error: 'Name, email, and password required' }, { status: 400 });
        }

        // Require invite code for registration
        if (!inviteCode) {
            return NextResponse.json({ error: 'Se requiere código de invitación' }, { status: 400 });
        }

        // Try to find as InviteCode first (admin-created)
        let invite = await prisma.inviteCode.findUnique({
            where: { code: inviteCode },
        });

        // If not an InviteCode, try as Couple code (partner invite)
        let couple = null;
        if (!invite) {
            couple = await prisma.couple.findUnique({
                where: { code: inviteCode },
                include: { members: true }
            });

            if (!couple) {
                return NextResponse.json({ error: 'Código de invitación inválido' }, { status: 400 });
            }

            if (couple.members.length >= 2) {
                return NextResponse.json({ error: 'Esta pareja ya está completa' }, { status: 400 });
            }
        } else {
            // Validate InviteCode
            if (invite.usedById) {
                return NextResponse.json({ error: 'Este código ya fue utilizado' }, { status: 400 });
            }

            if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
                return NextResponse.json({ error: 'Este código ha expirado' }, { status: 400 });
            }
        }

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user + consume invite atomically.
        // The invite-code consume is conditional (updateMany where still unused)
        // so that concurrent signups can't both consume the same single-use code.
        const inviteId = invite?.id;
        const user = await prisma.$transaction(async (tx) => {
            // Create user (with coupleId if registering via couple invite)
            const created = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    avatar: "👤",
                    coupleId: couple?.id || undefined,
                },
            });

            // Mark InviteCode as used (only if still unused — single winner)
            if (inviteId) {
                const consumed = await tx.inviteCode.updateMany({
                    where: { id: inviteId, usedById: null },
                    data: {
                        usedById: created.id,
                        usedAt: new Date(),
                    },
                });

                if (consumed.count === 0) {
                    // Lost the race: another signup already consumed this code.
                    throw new Error('INVITE_ALREADY_USED');
                }
            }

            return created;
        });

        // Set Session (JWT)
        const token = await signToken({
            userId: user.id,
            email: user.email,
            isAdmin: user.isAdmin
        });

        const cookieStore = await cookies();
        cookieStore.set('session_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 // 7 days
        });

        // Clear old insecure cookie if present
        cookieStore.delete('user_id');

        return NextResponse.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin }
        });

    } catch (error) {
        if (error instanceof Error && error.message === 'INVITE_ALREADY_USED') {
            return NextResponse.json({ error: 'Este código ya fue utilizado' }, { status: 400 });
        }
        console.error("Registration Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
