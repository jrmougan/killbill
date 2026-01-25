import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, email, password, inviteCode } = body;

        if (!name || !email || !password) {
            return NextResponse.json({ error: 'Name, email, and password required' }, { status: 400 });
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

        // Handle Group (Join existing or Create new)
        let group;
        if (inviteCode) {
            group = await prisma.group.findUnique({
                where: { code: inviteCode },
            });
        }

        if (group) {
            // Join existing
            await prisma.user.update({
                where: { id: user.id },
                data: { groupId: group.id },
            });
        } else {
            // Create new
            const newGroup = await prisma.group.create({
                data: {
                    name: `${name}'s Group`,
                    code: Math.random().toString(36).substring(7).toUpperCase(),
                },
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { groupId: newGroup.id },
            });
        }

        // Set Session
        const cookieStore = await cookies();
        cookieStore.set('user_id', user.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

        return NextResponse.json({ success: true, user });

    } catch (error) {
        console.error("Registration Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
