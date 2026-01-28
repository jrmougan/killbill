import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email, password, inviteCode } = body;

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
        }

        // 1. Find User
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.password) {
            return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
        }

        // 2. Verify Password
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
        }

        // 3. Handle Couple Invite
        if (inviteCode) {
            const couple = await prisma.couple.findUnique({
                where: { code: inviteCode },
                include: { members: true }
            });

            if (couple && couple.members.length < 2) {
                // Set coupleId
                await prisma.user.update({
                    where: { id: user.id },
                    data: { coupleId: couple.id },
                });
            }
        }

        // 4. Set Session (JWT)
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
        console.error("Login Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
