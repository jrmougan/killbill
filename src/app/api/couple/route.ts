import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!user?.coupleId) return NextResponse.json({ couple: null });

    return NextResponse.json({ couple: user.couple });
}

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { name } = body;

    // Generate random code for invite
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const couple = await prisma.couple.create({
        data: {
            name: name || "Nuestra Pareja",
            code: code,
            members: {
                connect: { id: userId }
            }
        }
    });

    return NextResponse.json({ success: true, couple });
}
