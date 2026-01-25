import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';

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

        // 3. Handle Group Invite
        if (inviteCode) {
            const group = await prisma.group.findUnique({
                where: { code: inviteCode },
            });

            if (group && user.groupId !== group.id) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { groupId: group.id },
                });
            }
        }

        // 3. Set Session
        const cookieStore = await cookies();
        cookieStore.set('user_id', user.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error("Login Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
