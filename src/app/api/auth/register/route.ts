import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { signToken } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, email, password, inviteCode } = body;

        if (!name || !email || !password) {
            return NextResponse.json({ error: 'Name, email, and password required' }, { status: 400 });
        }

        // Require invite code for registration
        if (!inviteCode) {
            return NextResponse.json({ error: 'Se requiere código de invitación' }, { status: 400 });
        }

        // Validate invite code
        const invite = await prisma.inviteCode.findUnique({
            where: { code: inviteCode },
        });

        if (!invite) {
            return NextResponse.json({ error: 'Código de invitación inválido' }, { status: 400 });
        }

        if (invite.usedById) {
            return NextResponse.json({ error: 'Este código ya fue utilizado' }, { status: 400 });
        }

        if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
            return NextResponse.json({ error: 'Este código ha expirado' }, { status: 400 });
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

        // Create user
        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                avatar: "👤",
            },
        });

        // Mark invite as used
        await prisma.inviteCode.update({
            where: { id: invite.id },
            data: {
                usedById: user.id,
                usedAt: new Date(),
            },
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

        return NextResponse.json({ success: true, user });

    } catch (error) {
        console.error("Registration Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
